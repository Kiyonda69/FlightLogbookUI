/**
 * Crew.gs — server-side access to the shared crew allocation rules (src/CrewRules.html).
 *
 * The rules live in CrewRules.html (plain JS in a <script> tag) so the browser UI and the server
 * share ONE copy. Here the file is evaluated with `new Function` (V8) to expose the table and the
 * allocateCrew() function for validation and tests.
 */

var crewRulesCache_ = null;

function loadCrewRules_() {
  if (crewRulesCache_) return crewRulesCache_;
  var src = HtmlService.createHtmlOutputFromFile('CrewRules').getContent().replace(/<\/?script[^>]*>/g, '');
  crewRulesCache_ = new Function(src +
    '\nreturn { CREW_PATTERNS: CREW_PATTERNS, CREW_DUTIES: CREW_DUTIES, CREW_KINDS: CREW_KINDS, CREW_DEFAULT_PATTERN: CREW_DEFAULT_PATTERN, ' +
    'allocateCrew: allocateCrew, crewPattern: crewPattern, crewFormula: crewFormula, parseCrewCode: parseCrewCode };')();
  return crewRulesCache_;
}

/** Patterns for clients that don't embed CrewRules.html (also handy for inspection). */
function apiCrewPatterns() {
  var r = loadCrewRules_();
  return { kinds: r.CREW_KINDS, duties: r.CREW_DUTIES, patterns: r.CREW_PATTERNS.map(function (p) {
    return { id: p.id, kind: p.kind, crew: p.crew, formulas: p.alloc.map(r.crewFormula) };
  }) };
}

/** Server-side allocation (same math as the UI). */
function apiAllocateCrew(patternId, member, block, xc, night) {
  return loadCrewRules_().allocateCrew(patternId, member, parseMinutes_(block), parseMinutes_(xc), parseMinutes_(night));
}
