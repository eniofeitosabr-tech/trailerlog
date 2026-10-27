-- EXCLUSIVAMENTE em Supabase de TESTES, após as duas migrations.
-- Executar o arquivo inteiro em uma conexão dedicada com privilégios para criar
-- fixtures em auth.users, contornar RLS na preparação e SET ROLE authenticated.
-- O executor deve garantir ROLLBACK/desconexão também quando interromper por erro.
-- As mensagens RLS são conferidas em inglês; outro lc_messages falha de forma segura.
begin;

do $$
declare
    users uuid[] := array[gen_random_uuid(), gen_random_uuid()];
    fixtures jsonb := '{}'::jsonb;
    tables text[] := array['trucks', 'journeys', 'trailer_uses', 'data_imports'];
    table_name text;
    privilege_name text;
    side integer;
    owner_id uuid;
    other_id uuid;
    own_row uuid;
    other_row uuid;
    own_journey uuid;
    other_journey uuid;
    new_row uuid;
    source_value text;
    values_sql text;
    insert_sql text;
    affected bigint;
    visible_count bigint;
    error_message text;
    error_constraint text;
    error_table text;
    error_schema text;
begin
    -- UUIDs aleatórios: colisões não são ignoradas; qualquer conflito aborta o teste.
    for side in 1..2 loop
        owner_id := users[side];
        insert into auth.users(id, email)
        values (owner_id, 'rls-' || owner_id::text || '@example.invalid');
        foreach table_name in array tables loop
            new_row := gen_random_uuid();
            fixtures := jsonb_set(fixtures, array[owner_id::text || ':' || table_name], to_jsonb(new_row));
            source_value := 'fixture-' || new_row::text;
            values_sql := case table_name
                when 'trucks' then format('truck_number) values (%L)', 'RLS')
                when 'journeys' then format('truck_number, started_at, ended_at, status) values (%L, now(), now(), %L)', 'RLS', 'Finalizada')
                when 'trailer_uses' then format('trailer_number) values (%L)', 'RLS')
                when 'data_imports' then format('checksum) values (%L)', repeat('a', 64))
            end;
            -- Reutiliza os mesmos campos obrigatórios nos testes; journeys finalizadas
            -- evitam interferência do índice de uma única jornada ativa por usuário.
            insert_sql := format('insert into public.%I (id, user_id, source_id, ', table_name)
                || replace(values_sql, 'values (', format('values (%L, %L, %L, ', new_row, owner_id, source_value));
            execute insert_sql;
        end loop;
    end loop;

    for side in 1..2 loop
        owner_id := users[side];
        other_id := users[3 - side];
        own_journey := (fixtures ->> (owner_id::text || ':journeys'))::uuid;
        other_journey := (fixtures ->> (other_id::text || ':journeys'))::uuid;
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub', owner_id::text, true);
        perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
        if current_user <> 'authenticated' or auth.uid() is distinct from owner_id then
            raise exception 'RLS: identidade incorreta para %', owner_id;
        end if;
        if exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
            raise exception 'RLS: authenticated possui bypass de RLS';
        end if;
        if not has_schema_privilege(current_user, 'public', 'USAGE')
            or not has_schema_privilege(current_user, 'auth', 'USAGE')
            or not has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') then
            raise exception 'RLS: permissões de schema/auth.uid() ausentes';
        end if;

        foreach table_name in array tables loop
            own_row := (fixtures ->> (owner_id::text || ':' || table_name))::uuid;
            other_row := (fixtures ->> (other_id::text || ':' || table_name))::uuid;
            if not (select relrowsecurity from pg_class where oid = format('public.%I', table_name)::regclass)
                or not row_security_active(format('public.%I', table_name)::regclass) then
                raise exception 'RLS: proteção inativa em %', table_name;
            end if;
            foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
                if not has_table_privilege(current_user, format('public.%I', table_name), privilege_name) then
                    raise exception 'RLS: privilégio % ausente em %', privilege_name, table_name;
                end if;
            end loop;

            execute format('select count(*) from public.%I where id = $1 and user_id = $2', table_name)
                into visible_count using own_row, owner_id;
            if visible_count <> 1 then raise exception 'RLS: fixture própria invisível em %', table_name; end if;
            execute format('select count(*) from public.%I where id = $1', table_name)
                into visible_count using other_row;
            if visible_count <> 0 then raise exception 'RLS: leitura cruzada em %', table_name; end if;

            -- Controle positivo completo, incluindo o default user_id = auth.uid().
            new_row := gen_random_uuid();
            source_value := 'positive-' || new_row::text;
            values_sql := case table_name
                when 'trucks' then format('truck_number) values (%L)', 'RLS')
                when 'journeys' then format('truck_number, started_at, ended_at, status) values (%L, now(), now(), %L)', 'RLS', 'Finalizada')
                when 'trailer_uses' then format('trailer_number, journey_id) values (%L, %L)', 'RLS', own_journey)
                when 'data_imports' then format('checksum) values (%L)', repeat('a', 64))
            end;
            insert_sql := format('insert into public.%I (id, source_id, ', table_name)
                || replace(values_sql, 'values (', format('values (%L, %L, ', new_row, source_value));
            execute insert_sql;
            get diagnostics affected = row_count;
            if affected <> 1 then raise exception 'RLS: INSERT próprio falhou em %', table_name; end if;
            execute format('select count(*) from public.%I where id = $1 and user_id = $2 and source_id = $3', table_name)
                into visible_count using new_row, owner_id, source_value;
            if visible_count <> 1 then raise exception 'RLS: SELECT próprio falhou em %', table_name; end if;
            execute format('update public.%I set source_id = $1 where id = $2', table_name)
                using source_value || '-updated', new_row;
            get diagnostics affected = row_count;
            if affected <> 1 then raise exception 'RLS: UPDATE próprio falhou em %', table_name; end if;
            execute format('select count(*) from public.%I where id = $1 and user_id = $2 and source_id = $3', table_name)
                into visible_count using new_row, owner_id, source_value || '-updated';
            if visible_count <> 1 then raise exception 'RLS: resultado do UPDATE incorreto em %', table_name; end if;
            execute format('delete from public.%I where id = $1', table_name) using new_row;
            get diagnostics affected = row_count;
            if affected <> 1 then raise exception 'RLS: DELETE próprio falhou em %', table_name; end if;
            execute format('select count(*) from public.%I where id = $1', table_name) into visible_count using new_row;
            if visible_count <> 0 then raise exception 'RLS: DELETE próprio não removeu linha em %', table_name; end if;

            execute format('update public.%I set source_id = $1 where id = $2', table_name)
                using 'invasion-' || gen_random_uuid()::text, other_row;
            get diagnostics affected = row_count;
            if affected <> 0 then raise exception 'RLS: UPDATE cruzado em %', table_name; end if;
            execute format('delete from public.%I where id = $1', table_name) using other_row;
            get diagnostics affected = row_count;
            if affected <> 0 then raise exception 'RLS: DELETE cruzado em %', table_name; end if;

            -- Novos IDs/source_id e journey_id NULL evitam outras restrições no INSERT
            -- cruzado; somente a propriedade deve provocar a rejeição.
            values_sql := case table_name
                when 'trucks' then format('truck_number) values (%L)', 'RLS')
                when 'journeys' then format('truck_number, started_at, ended_at, status) values (%L, now(), now(), %L)', 'RLS', 'Finalizada')
                when 'trailer_uses' then format('trailer_number) values (%L)', 'RLS')
                when 'data_imports' then format('checksum) values (%L)', repeat('a', 64))
            end;
            insert_sql := format('insert into public.%I (id, user_id, source_id, ', table_name)
                || replace(values_sql, 'values (', format('values (%L, %L, %L, ', gen_random_uuid(), other_id, 'negative-' || gen_random_uuid()::text));
            begin
                execute insert_sql;
                raise exception 'RLS: INSERT cruzado permitido em %', table_name;
            exception when insufficient_privilege then
                get stacked diagnostics error_message = message_text;
                if error_message is distinct from format('new row violates row-level security policy for table "%s"', table_name) then
                    raise; -- Não aceitar permission denied ou outro erro 42501.
                end if;
            end;
            begin
                execute format('update public.%I set user_id = $1 where id = $2', table_name) using other_id, own_row;
                get diagnostics affected = row_count;
                raise exception 'RLS: troca de proprietário não foi rejeitada em % (linhas: %)', table_name, affected;
            exception when insufficient_privilege then
                get stacked diagnostics error_message = message_text;
                if error_message is distinct from format('new row violates row-level security policy for table "%s"', table_name) then raise; end if;
            end;
        end loop;

        -- Fixture própria sem vínculo: a troca de proprietário acima não depende da FK.
        -- Agora validamos especificamente a FK composta em INSERT e UPDATE.
        for affected in 1..2 loop
            begin
                if affected = 1 then
                    insert into public.trailer_uses(source_id, trailer_number, journey_id)
                    values ('cross-link-' || gen_random_uuid()::text, 'RLS', other_journey);
                else
                    update public.trailer_uses set journey_id = other_journey
                    where id = (fixtures ->> (owner_id::text || ':trailer_uses'))::uuid;
                end if;
                raise exception 'RLS: vínculo cruzado não foi rejeitado (operação %)', affected;
            exception when foreign_key_violation then
                get stacked diagnostics error_constraint = constraint_name,
                    error_table = table_name, error_schema = schema_name;
                if error_constraint is distinct from 'trailer_uses_user_id_journey_id_fkey'
                    or error_table is distinct from 'trailer_uses'
                    or error_schema is distinct from 'public' then raise; end if;
            end;
        end loop;
        -- UPDATE positivo do vínculo: a jornada própria precisa ser aceita.
        update public.trailer_uses set journey_id = own_journey
        where id = (fixtures ->> (owner_id::text || ':trailer_uses'))::uuid;
        get diagnostics affected = row_count;
        if affected <> 1 then raise exception 'RLS: vínculo próprio por UPDATE falhou'; end if;
        if not exists (select 1 from public.trailer_uses
            where id = (fixtures ->> (owner_id::text || ':trailer_uses'))::uuid
              and user_id = owner_id and journey_id = own_journey) then
            raise exception 'RLS: vínculo próprio por UPDATE incorreto';
        end if;
        -- Restaura para manter o cenário simétrico e independente da ordem.
        update public.trailer_uses set journey_id = null
        where id = (fixtures ->> (owner_id::text || ':trailer_uses'))::uuid;
        execute 'reset role';
    end loop;
end $$;

rollback;
