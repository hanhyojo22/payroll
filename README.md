# Payroll & Payment Reminder

A simple desktop web app for one admin user to manage employees, monthly payroll runs, and loan/bill reminders.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project and run `supabase_schema.sql` in the Supabase SQL editor.

3. Copy `.env.example` to `.env` and fill in:

   ```bash
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   ```

4. Start the local app:

   ```bash
   npm run dev
   ```

5. Open the local URL shown by Vite. Create the admin account from the login screen, then use that same account to sign in.

## Features

- Supabase email/password auth
- Employee profiles with salary, HR details, and Philippine ID fields
- Twice-monthly payroll generation for all active employees
- Admin-selected generated date for each payroll run
- Manual allowances and deductions per payroll item
- First-half and second-half payroll runs that start from half of monthly salary
- Payroll history with gross, deduction, net, pending, and paid status
- Payment reminders for loans and bills
- In-app dashboard for payroll status and payment reminders
- Search, filter, edit, delete, and mark-paid actions
- Row-level security policies so records belong to the logged-in user
