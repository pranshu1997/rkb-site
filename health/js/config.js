// Public by design: the anon key grants only what RLS allows.
// Local values from `supabase status`. Swap for the hosted project at deploy (M6).
export const SUPABASE_URL = "https://yoycnblzoyshzgblyrqg.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveWNuYmx6b3lzaHpnYmx5cnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwODkzMzMsImV4cCI6MjEwNjY2NTMzM30.JaD8g87jTqTMuE-UVRN8jnHJ2kV3OoP2YY93p2o4noI";
export const STEPS_TARGET = 10000;
// Papa asked for a flag when stool is counted more than this many times in a day.
export const STOOL_MAX = 2;
// A day is green when these are logged and every due dose is ticked. Weight and diet are optional.
// Insulin units shown until a first dose is saved; after that the last saved dose carries forward day to day.
export const INSULIN_DEFAULT = 16;
export const REQUIRED_METRICS = ['bp', 'sugar', 'steps'];
// Papa may count minutes walked instead of steps: either one satisfies the required 'steps' item.
export const METRIC_ALSO = { steps: 'walk_min' };
// Fallback daily food targets, used until targets are saved in the app (Settings > Food targets, table food_target).
// Calories in kcal; the rest in grams. Sugar counts free/added sugar for Indian dishes, total sugars for fruit.
export const FOOD_TARGET = { kcal: 1800, carbs: 180, sugar: 25, protein: 60, fat: 55, fibre: 25 };
// Bump together with CACHE in sw.js on every deploy.
export const APP_VERSION = '47';
// Web Push public key (public by design). Empty until the server key pair is made at deploy (M6).
export const VAPID_PUBLIC_KEY = 'BFXTiiSklguwR0Izo6avYmiVrZxs1_GKJtqigpen6DJtXVB6NE7c94uWjITvZHw5aKb1MdvW8YxiQVtCZUtQ6H8';
