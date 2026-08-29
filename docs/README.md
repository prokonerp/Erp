# Prokon ERP — Stakeholder Presentation

A single, self-contained slide deck that explains the entire Prokon ERP system to **non-technical stakeholders** — in plain business language.

## ▶️ How to Open

**Double-click `presentation.html`** — it opens in any browser (Chrome, Edge, Safari).

- ✅ Works completely offline (no internet needed)
- ✅ No installation, no server, no dependencies

## 🎮 Presenting

| Key / Action | What it does |
|---|---|
| `→` or `Space` | Next slide |
| `←` | Previous slide |
| `Home` / `End` | First / last slide |
| `F` | Fullscreen (recommended while presenting) |
| Click chips/cards | Jump to that module's slide |
| Swipe left/right | Navigate on touch devices |

The deck auto-scales to any screen or projector. A progress bar and slide counter are built in.

## 📑 The 15 Slides

| # | Slide | # | Slide |
|---|-------|---|-------|
| 1 | Title — Prokon ERP at a glance | 9 | Service (flow + AMC) |
| 2 | The Journey of One Sale | 10 | Finance (payments & GST) |
| 3 | Meet the 8 Modules (clickable grid) | 11 | HR & Payroll |
| 4 | Follow One Customer Order | 12 | Admin & Control |
| 5 | CRM | 13 | Right People, Right Access |
| 6 | Sales | 14 | Everything Is Recorded (audit) |
| 7 | Inventory (IN/OUT + serials) | 15 | Why This Wins |
| 8 | Purchase | | |

Each module slide shows:
1. **One-line purpose** of the module
2. **Internal flowchart** — how the module works, step by step
3. **"🤝 Works together with" chips** — only the modules it connects to (clickable)

## 🖨️ Export to PDF

1. Open the file in Chrome
2. `File → Print` (or `Ctrl/Cmd + P`)
3. Destination: **Save as PDF**, Layout: Landscape
4. Save — each slide becomes one PDF page

## 🎨 Customizing

Open `presentation.html` in any text editor:

- **Brand colors** — top of the CSS block:
  ```css
  :root{ --navy:#1e3a5f; --crm:#0284c7; --sales:#d97706; ... }
  ```
- **Text** — edit any slide's HTML directly; each `<section class="slide">` is one slide
- **Slide order/count** — add/remove sections; navigation adapts automatically

## 🔗 Deep Linking

Append `#<slide-number>` to the URL to open at a specific slide,
e.g. `presentation.html#8` opens on Purchase.
