// Subcontractor trades, detected from a company's name, type, categories and description.
// Patterns are checked against the "strong" fields first; the description is only used as a fallback
// because general contractors' descriptions often list every trade they coordinate.
export const TRADES = [
  ['Electrical', /electric|electrician|lighting|solar/i],
  ['Low Voltage / Security', /low.?voltage|security|access control|data cabling|structured cabling|audio.?visual/i],
  ['Plumbing', /plumb|piping|backflow|sewer|drain/i],
  ['HVAC / Mechanical', /hvac|mechanical|heating|air.?condition|refrigerat|sheet ?metal|ventilat|boiler/i],
  ['Fire Protection', /fire (protection|sprinkler|alarm)|sprinkler/i],
  ['Concrete', /concrete|cement|foundation|shotcrete|tilt.?up/i],
  ['Masonry', /masonry|brick|stone ?work|stucco/i],
  ['Steel / Iron', /steel|iron ?work|welding|metal fabricat|structural metal|rebar|misc(ellaneous)? metals/i],
  ['Glass / Glazing', /glass|glazing|window|curtain ?wall|storefront|skylight|daylight/i],
  ['Roofing', /roof|waterproof/i],
  ['Siding / Exterior', /siding|cladding|exterior (finish|wall)|eifs|rainscreen/i],
  ['Drywall / Framing', /drywall|framing|plaster|acoustical|ceiling|metal stud|insulation|interiors?\b|wall systems/i],
  ['Painting', /paint|coating|wall ?cover/i],
  ['Flooring', /floor|tile|carpet|terrazzo/i],
  ['Carpentry / Millwork', /carpent|millwork|cabinet|woodwork|casework/i],
  ['Excavation / Sitework', /excavat|grading|earthwork|site ?work|demolition|underground utilit|trenching/i],
  ['Paving / Asphalt', /paving|asphalt/i],
  ['Landscaping', /landscap|irrigation|tree service/i],
  ['Fencing', /fenc(e|ing)/i],
  ['Doors / Hardware', /\bdoors?\b|door hardware/i],
  ['General Contractor', /general contract|design.?build|construction management|\bGC\b/],
];

export const TRADE_NAMES = TRADES.map(([name]) => name);

export function classifyTrades({ name, company_type, custom, description }) {
  const customText = Object.values(custom || {}).filter((v) => typeof v === 'string').join(' ');
  const strong = [name, company_type, customText].filter(Boolean).join(' ');
  const found = TRADES.filter(([, re]) => re.test(strong)).map(([n]) => n);
  if (found.length) return found;
  const desc = (description || '').slice(0, 220);
  return TRADES.filter(([, re]) => re.test(desc)).map(([n]) => n).slice(0, 2);
}
