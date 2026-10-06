-- Symptom catalog (reference data, not PHI). Must match packages/core/src/catalog.ts
-- (enforced by tests/db/catalog-sync.test.ts).
insert into public.symptom_catalog (code, label, plain_label, help_text, category, is_core, sort_order) values
  ('fall_or_near_fall', 'Fall or near-fall', 'fallen or almost fallen', 'A slip, trip, or fall, even if no one was hurt.', 'safety', true, 1),
  ('confusion', 'Confusion', 'felt confused or foggy', 'Mixed up about time or place, or hard to think clearly.', 'thinking', true, 2),
  ('dizziness', 'Dizziness', 'felt dizzy or unsteady', 'Light-headed, spinning, or wobbly when standing or walking.', 'balance', true, 3),
  ('shortness_of_breath', 'Shortness of breath', 'felt short of breath', 'Hard to catch your breath, at rest or when moving.', 'breathing', true, 4),
  ('drowsiness', 'Drowsiness', 'felt very sleepy in the daytime', 'Nodding off or hard to stay awake during the day.', 'thinking', false, 5),
  ('nausea', 'Nausea', 'felt sick to your stomach', 'Queasy, or feeling like you might throw up.', 'stomach', false, 6),
  ('constipation', 'Constipation', 'had trouble with bowel movements', 'Hard stools, or fewer bowel movements than usual.', 'stomach', false, 7),
  ('diarrhea', 'Diarrhea', 'had loose or watery stools', 'Loose stools more than once in a day.', 'stomach', false, 8),
  ('dry_mouth', 'Dry mouth', 'had a very dry mouth', 'Mouth feels dry or sticky, or it is hard to swallow.', 'mouth', false, 9),
  ('headache', 'Headache', 'had a headache', 'Any ache or pressure in the head.', 'pain', false, 10),
  ('fatigue', 'Fatigue', 'felt very tired or weak', 'Less energy than usual for everyday tasks.', 'energy', false, 11),
  ('low_appetite', 'Low appetite', 'felt less hungry than usual', 'Skipping meals or eating much less.', 'stomach', false, 12),
  ('leg_swelling', 'Swelling in legs', 'had swelling in your legs or feet', 'Puffy ankles, feet, or legs, or tight socks or shoes.', 'heart', false, 13),
  ('cough', 'Cough', 'had a cough', 'A new cough or one that is worse than usual.', 'breathing', false, 14),
  ('rash', 'Rash', 'had a new rash or itchy skin', 'Red spots, bumps, or itching that is new.', 'skin', false, 15),
  ('bruising_or_bleeding', 'Bruising or bleeding', 'had new bruises or bleeding', 'Bruises you cannot explain, nosebleeds, or bleeding gums.', 'skin', false, 16),
  ('muscle_pain', 'Muscle pain', 'had muscle aches or pain', 'Sore, achy, or weak muscles.', 'pain', false, 17),
  ('trouble_sleeping', 'Trouble sleeping', 'had trouble sleeping', 'Hard to fall asleep or stay asleep last night.', 'sleep', false, 18),
  ('low_mood', 'Low mood', 'felt sad or down', 'Feeling blue, worried, or not like yourself.', 'mood', false, 19),
  ('urinary_problems', 'Urinary problems', 'had trouble passing urine', 'Hard to start, going often, leaking, or burning.', 'bladder', false, 20)
on conflict (code) do update set
  label = excluded.label,
  plain_label = excluded.plain_label,
  help_text = excluded.help_text,
  category = excluded.category,
  is_core = excluded.is_core,
  sort_order = excluded.sort_order;
