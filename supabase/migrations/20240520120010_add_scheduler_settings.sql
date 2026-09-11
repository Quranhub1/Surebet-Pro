/*
  # Add Scheduler Settings to System Settings
  Adds scheduler configuration columns to the system_settings table.
  
  ## Query Description:
  This operation adds columns for scheduler configuration (enabled, run_hour, run_minute, timezone, last_run tracking) to the system_settings table.
  
  ## Metadata:
  - Schema-Category: "Structural"
  - Impact-Level: "Low"
  - Requires-Backup: false
  - Reversible: true
*/

ALTER TABLE public.system_settings 
ADD COLUMN IF NOT EXISTS scheduler_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS run_hour integer NOT NULL DEFAULT 6,
ADD COLUMN IF NOT EXISTS run_minute integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Kampala',
ADD COLUMN IF NOT EXISTS last_run_date date,
ADD COLUMN IF NOT EXISTS last_run_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS last_run_status text;

-- Update the existing row with default scheduler settings
UPDATE public.system_settings 
SET 
  scheduler_enabled = false,
  run_hour = 6,
  run_minute = 0,
  timezone = 'Africa/Kampala'
WHERE id = 1;
