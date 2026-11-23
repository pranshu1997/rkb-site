// Target suggestion maths from a body profile. Pure, so tests run in node.

export const ACTIVITY = { sedentary: ['Sedentary', 1.2, 'little or no exercise'], light: ['Light', 1.375, 'walks or light exercise 1-3 days a week'],
  moderate: ['Moderate', 1.55, 'exercise 3-5 days a week'], active: ['Active', 1.725, 'hard exercise 6-7 days a week'] };
export const GOALS = { maintain: ['Maintain weight', 0, '', 'Maintain'], lose: ['Lose about 0.5 kg a week', -500, ' (about 0.5 kg a week)', 'Lose weight'], gain: ['Gain weight', 300, '', 'Gain weight'] };
export const KEYS = ['kcal', 'carbs', 'sugar', 'protein', 'fat', 'fibre'];
export const LABEL = { kcal: 'Calories', carbs: 'Carbs', sugar: 'Sugar', protein: 'Protein', fat: 'Fat', fibre: 'Fibre' };
export const UNIT = { kcal: 'kcal', carbs: 'g', sugar: 'g', protein: 'g', fat: 'g', fibre: 'g' };

const round = (x, step = 1) => Math.round(x / step) * step;
const KCAL_FLOOR = { male: 1500, female: 1200 };

// Mifflin-St Jeor resting energy: 10 w + 6.25 h - 5 age + 5 (male) or - 161 (female).
export const bmr = ({ weight_kg: w, height_cm: h, age, sex }) => 10 * w + 6.25 * h - 5 * age + (sex === 'female' ? -161 : 5);

export const complete = p => !!(p && p.weight_kg > 0 && p.height_cm > 0 && p.age > 0 && p.sex && ACTIVITY[p.activity] && GOALS[p.goal]);

// Suggested targets and a one-line reason (with the rule) for each. null when the profile is incomplete.
// `tr` translates the reasons (i18n t); the default only fills the {placeholders}.
const fill = (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => v[k]);
export function suggest(p, tr = fill) {
  if (!complete(p)) return null;
  const base = bmr(p), tdee = base * ACTIVITY[p.activity][1];
  const kcal = Math.max(KCAL_FLOOR[p.sex], round(tdee + GOALS[p.goal][1], 10));
  const older = p.age >= 65, gkg = older ? 1.0 : 0.8;
  const carbPct = p.diabetes ? 0.425 : 0.5, sugarPct = p.diabetes ? 0.05 : 0.10;
  const goalNote = p.goal === 'maintain' ? '' : tr(GOALS[p.goal][1] > 0 ? ' +{n} for the goal' : ' −{n} for the goal', { n: Math.abs(GOALS[p.goal][1]) }) + (GOALS[p.goal][2] && tr(GOALS[p.goal][2]));
  return {
    kcal: [kcal, tr('Resting {base} kcal (Mifflin-St Jeor) × {factor} for {activity} activity{goal}.', { base: Math.round(base), factor: ACTIVITY[p.activity][1], activity: tr(ACTIVITY[p.activity][0].toLowerCase()), goal: goalNote })],
    protein: [round(gkg * p.weight_kg), tr(older ? '{g} g per kg body weight (1.0 for age 65 and over).' : '{g} g per kg body weight (adult minimum 0.8).', { g: gkg })],
    fat: [round((0.28 * kcal) / 9), tr('28% of calories (guideline range 25-30%), 9 kcal per gram.')],
    fibre: [Math.max(25, round((14 * kcal) / 1000)), tr('14 g per 1000 kcal, at least 25 g (dietary guideline).')],
    sugar: [round((sugarPct * kcal) / 4), tr(p.diabetes ? '{pct}% of calories as free sugar (WHO: under 10%, ideally under 5%; 5% chosen for diabetes), 4 kcal per gram.' : '{pct}% of calories as free sugar (WHO: under 10%, ideally under 5%), 4 kcal per gram.', { pct: sugarPct * 100 })],
    carbs: [round((carbPct * kcal) / 4, 5), tr(p.diabetes ? '42.5% of calories (diabetes range 40-45%), 4 kcal per gram.' : '50% of calories (usual range 45-55%), 4 kcal per gram.')],
  };
}

