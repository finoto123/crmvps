-- Serializa a disputa pelo horário do mesmo responsável. A consulta de slots
-- feita pelo aplicativo ocorre antes do INSERT e sozinha não fecha a corrida.
create or replace function public.fn_appointment_prevent_overlap()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.owner_user_id is null or new.status not in ('pending','confirmed') then
    return new;
  end if;
  if tg_op = 'UPDATE' and
    new.organization_id = old.organization_id and
    new.owner_user_id = old.owner_user_id and
    new.starts_at = old.starts_at and new.ends_at = old.ends_at and
    old.status in ('pending','confirmed') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.organization_id::text || ':' || new.owner_user_id::text, 177)
  );
  if exists (
    select 1 from public.calendar_appointments a
    where a.organization_id = new.organization_id
      and a.owner_user_id = new.owner_user_id
      and a.id <> new.id
      and a.status in ('pending','confirmed')
      and a.starts_at = new.starts_at and a.ends_at = new.ends_at
  ) then
    raise exception 'appointment_slot_taken' using errcode='P0001';
  end if;
  return new;
end; $$;
revoke all on function public.fn_appointment_prevent_overlap() from public,anon,authenticated;
drop trigger if exists trg_appointment_prevent_overlap on public.calendar_appointments;
drop trigger if exists trg_zzzz_appointment_prevent_overlap on public.calendar_appointments;
create trigger trg_zzzz_appointment_prevent_overlap before insert or update of organization_id,owner_user_id,starts_at,ends_at,status
on public.calendar_appointments for each row execute function public.fn_appointment_prevent_overlap();
