begin;
-- SECURITY INVOKER é o padrão: nenhum bypass de RLS ou service_role.
do $$
declare table_name text;
begin
    foreach table_name in array array['trucks', 'journeys', 'trailer_uses', 'data_imports'] loop
        execute format('create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name);
        execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name);
        execute format('create policy owner_update on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
        execute format('create policy owner_delete on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name);
        execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    end loop;
end $$;
commit;
