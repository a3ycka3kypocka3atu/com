import type { Community, Land, MatchResult, Person, Project } from "./types";

const overlap = (left: string[], right: string[]) => left.filter((item) => right.includes(item));

export function matchPersonToCommunity(person: Person, community: Community): MatchResult {
  let earned = 0;
  let possible = 0;
  const strong: string[] = [];
  const partial: string[] = [];
  const discuss: string[] = [];

  possible += 18;
  if (person.preferredCountries.includes(community.country)) {
    earned += 18;
    strong.push(`${community.region} is within your preferred geography`);
  } else {
    partial.push("Location is outside your saved regions");
  }

  possible += 12;
  if (person.preferredTypes.includes(community.type)) {
    earned += 12;
    strong.push(`${community.type} matches your preferred community model`);
  } else if (community.kind === "emerging") {
    earned += 5;
    partial.push("The community model is still being defined");
  }

  possible += 10;
  const sizeTarget = community.kind === "community" ? community.residents : Number(community.target.split("–")[0] || 0);
  if (sizeTarget >= person.preferredSize[0] && sizeTarget <= person.preferredSize[1]) {
    earned += 10;
    strong.push("Community size is within your preferred range");
  } else {
    partial.push("Community size differs from your preferred range");
  }

  possible += 10;
  if (person.family === "Family" ? community.familyFriendly : true) {
    earned += 10;
    if (person.family === "Family") strong.push("Family-oriented living is supported");
  } else {
    partial.push("Family fit needs a closer conversation");
  }

  possible += 12;
  const ecologicalOverlap = overlap(person.ecology, community.ecology);
  earned += Math.min(12, ecologicalOverlap.length * 4);
  if (ecologicalOverlap.length) strong.push(`${ecologicalOverlap.slice(0, 2).join(" and ")} align with your interests`);

  possible += 12;
  if (person.governance.some((preference) => community.governance.toLowerCase().includes(preference.toLowerCase()))) {
    earned += 12;
    strong.push(`${community.governance} aligns with your governance preference`);
  } else {
    partial.push(`Community uses ${community.governance}`);
  }

  possible += 14;
  const valueOverlap = overlap(person.values, community.values);
  earned += Math.min(14, valueOverlap.length * 3.5);
  if (valueOverlap.length) strong.push(`${valueOverlap.slice(0, 3).join(", ")} are shared values`);

  possible += 8;
  const skillOverlap = overlap(person.skills, community.needs);
  if (skillOverlap.length) {
    earned += 8;
    strong.push(`They are looking for your ${skillOverlap.slice(0, 2).join(" and ")} skills`);
  } else {
    discuss.push("No direct skill-need match is currently listed");
  }

  possible += 4;
  if (community.accepting) earned += 4;
  else discuss.push("Membership is not currently open");

  const score = Math.max(42, Math.min(96, Math.round((earned / possible) * 100)));
  return {
    score,
    label: score >= 80 ? "High compatibility" : score >= 65 ? "Good compatibility" : "Potential fit",
    strong: strong.slice(0, 5),
    partial: partial.slice(0, 2),
    discuss: discuss.slice(0, 2),
  };
}

export function matchLandToProject(land: Land, project: Project): MatchResult {
  let score = 24;
  const strong: string[] = [];
  const partial: string[] = [];
  const discuss: string[] = [];

  if (project.countries.includes(land.country)) {
    score += 22;
    strong.push(`${land.country} is one of the project’s target countries`);
  } else partial.push("Outside the project’s target countries");

  const targetArea = Number(project.landRequirement.replace(/[^0-9.]/g, "")) || 12;
  if (land.area >= targetArea * 0.75) {
    score += 16;
    strong.push(`${land.area} ha meets the approximate land requirement`);
  } else partial.push("Land area is below the current target");

  if (land.water) { score += 12; strong.push("On-site water is reported"); }
  else discuss.push("Water access needs investigation");
  if (land.agricultural) { score += 10; strong.push("Agricultural use is reported"); }
  if (land.buildings) { score += 8; strong.push("Existing buildings could support early use"); }
  if (land.construction.toLowerCase().includes("permitted")) score += 8;
  else discuss.push("Planning and construction status needs verification");

  score = Math.min(94, score);
  return {
    score,
    label: score >= 80 ? "High compatibility" : score >= 65 ? "Good compatibility" : "Potential fit",
    strong: strong.slice(0, 5),
    partial,
    discuss,
  };
}
