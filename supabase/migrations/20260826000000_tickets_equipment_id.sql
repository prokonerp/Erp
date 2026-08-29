-- Link a service ticket to the installed equipment record it concerns.
-- Populated when a ticket is raised from the Installed Equipment page, or when
-- a technician types a serial number on the New Ticket form:
--   * if the (customer, serial) already exists -> reuse that equipment row
--   * if it does not exist -> a new installed_equipment row is appended and linked
-- This makes the Installed Equipment register the system of record even when
-- the entry point is a complaint/ticket.

alter table public.tickets
  add column if not exists equipment_id uuid;

alter table public.tickets
  add constraint tickets_equipment_id_fkey
  foreign key (equipment_id)
  references public.installed_equipment (id)
  on delete set null;

create index if not exists tickets_equipment_id_idx
  on public.tickets (equipment_id);
