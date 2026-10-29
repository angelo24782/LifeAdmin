-- M3 · `service_role_explicit_grants`: privilegi espliciti e minimi di `service_role` sulle tabelle
-- di public (SPECIFICA §6).
--
-- Fino a qui `service_role` riceveva tutti i privilegi dai privilegi predefiniti di Supabase
-- (grant automatici della Data API, `[api] auto_expose_new_tables`), non dalle migration. Supabase
-- non li applica più alle tabelle nuove, anche quando lo schema viene ricreato dalle migration: da
-- qui i privilegi sono dichiarati.
--
-- Solo ciò che è usato oggi (test di integrazione via Data API): lettura e cancellazione dei
-- profili, lettura e inserimento delle categorie, lettura delle scadenze. La cancellazione di un
-- utente non richiede privilegi a `service_role`: GoTrue cancella `auth.users` con il proprio ruolo
-- e le cascate delle FK girano come proprietario delle tabelle. Le Edge Function future aggiungono
-- i propri grant nella migration che le introduce.
--
-- Il `revoke all` iniziale rende identico lo stato su un database esistente (che aveva tutti i
-- privilegi) e su uno nuovo (dove i privilegi predefiniti lasciano comunque TRUNCATE, REFERENCES,
-- TRIGGER e MAINTAIN).

revoke all on table
  public.profiles,
  public.categories,
  public.life_items,
  public.recurrence_rules,
  public.item_completions
from service_role;

grant select, delete on table public.profiles to service_role;
grant select, insert on table public.categories to service_role;
grant select on table public.life_items to service_role;
