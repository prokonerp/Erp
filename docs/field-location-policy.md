# Location Tracking Policy — Field Engineers (BYOD), v1

This phone is yours. This document says exactly what duty tracking does. Duty stays off until you accept in the app; this text matches the in-app consent dialog word for word in substance.

## What is collected

- GPS position (latitude, longitude, accuracy) **only while you are on duty**.
- Duty start/end times, and the site visits, reports, and photos you submit while on duty (each tagged with the location at that moment).

## When

- Tracking starts when **you** tap Start duty, and stops the moment you go off duty — end of shift, app closed, or session auto-closed after 2 hours idle.
- Nothing is recorded off duty. Browsing your queue off duty records nothing.

## How long it is kept

- Raw locations are **deleted after 30 days**, automatically.
- Only a daily summary is kept permanently: distance travelled, stop count, and site list per day.

## Who can see it

- **You** see only your own duty state — never a map of yourself.
- **Admins** see on-duty engineers as "last seen X ago" on the roster and day routes. Nobody can see you off duty.
- Consent records are append-only; managers can grant short, reasoned, logged passes for dead zones (basements), which you will see when active.

## Withdrawing consent

Go off duty at any time — tracking stops immediately. To withdraw fully (including deletion questions), contact your administrator. Refusing or withdrawing never affects your access to view your own jobs.

## Version

v1 — 2026-09-18. If this text changes, the app will ask you to consent again before duty can start.
