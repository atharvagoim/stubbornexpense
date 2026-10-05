# Expense Tracker

"See where your money goes — Track your expenses." A phone-first expense tracker built one-to-one on the Figma frames (390 × 844).

```
public/   the app (index.html, app.css, app.js, img/, fonts/)
server/   Express API: accounts, transactions, profile
api/      Vercel entry point
```

## Run it on your computer
```bash
npm install
cp .env.example .env     # optional: set JWT_SECRET
npm start                # http://localhost:3000
```
Without `MONGODB_URI`, data is saved to `data/db.json`.

## What it does
- **Get Started → Login / Sign up** (name, username, email, password).
- **Home:** live balance, **CREDIT** (Salary, Allowance, ? Custom) and **DEBIT** (Travel, Food, Fuel, Coke, Shopping, Alcohol, Bills, Maintenance, Groceries, ? Custom).
- **History:** every entry with icon, time and amount; **Date to Date** filter, **Sort by** (newest, oldest, highest, lowest); tap a row → Delete.
- **Analysis:** credited vs debited, spending by category (donut + bars), last 7 days.
- **Menu (☰):** profile photo (Edit / Remove), edit full name, username, email (pencil), Log Out.

## AI quick entry (speak or type)
At the bottom of the home screen: type or tap the mic and say e.g. *"spent 250 on uber and got 5000 salary"*.
It works out credit/debit, the amount and the best category for each item, adds them, and shows **Undo**.
- With `ANTHROPIC_API_KEY` set (from console.anthropic.com) it uses Claude (`claude-haiku-4-5-20251001`, change with `AI_MODEL`) — understands almost any wording and invents sensible custom categories.
- Without a key it uses a built-in keyword parser (free, offline) that handles common phrases.
- Voice uses the browser's speech recognition (Chrome, Edge, Safari). The mic button hides where it isn't supported.

## Security
- Passwords hashed with scrypt; weak/common passwords and passwords matching your username are refused.
- Login guessing is limited per IP **and** per account (8 wrong passwords → that account waits 15 minutes).
- httpOnly session cookie (30 days, HTTPS-only on HTTPS, tied to the password); same-site checks on every change.
- Strict Content-Security-Policy and security headers; small request-size limits; clean JSON errors (no stack traces).
- Each user only ever sees their own data; deleting your account needs your password.
- **Production needs `JWT_SECRET`** (32+ random characters) — the server refuses to start without it, so sessions stay valid across instances.

## Deploy on Vercel
1. Create a free MongoDB Atlas cluster (Network Access → `0.0.0.0/0`) and copy the connection string.
2. Push this folder to GitHub, then on vercel.com: **Add New → Project** → import it (preset **Other**).
3. Environment variables: `MONGODB_URI`, `JWT_SECRET` (long random string), `NODE_ENV=production`.
4. Deploy.

## Deploy on Render
New → Web Service → build `npm install`, start `npm start`, same environment variables.
