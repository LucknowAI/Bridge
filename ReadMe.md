User enters phone / email
        │
        ▼
Check registered_attendees table in Supabase
        │
   ┌────┴────┐
Not found   Found
   │           │
   ▼      ┌────┴────────┐
Block    Phone          Email
         │               │
         ▼               ▼
   Supabase OTP    Supabase Google OAuth
   (via Twilio)    (redirect → callback)
         │               │
         ▼               ▼
    Verify OTP    Verify email matches
         │         registered_attendees
         └────┬────┘
              ▼
        onAuthSuccess()
        → Load matchmaking app