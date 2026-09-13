/**
 * Technology/skill dictionary with synonyms. Used by the job parser, resume parser,
 * matcher and grounding validator so every component agrees on canonical names.
 */

export type SkillCategory = "language" | "frontend" | "backend" | "database" | "cloud" | "devops" | "tool" | "data" | "practice";

export interface SkillDef {
  name: string;
  category: SkillCategory;
  patterns: RegExp[];
}

// Boundaries that treat ".", "+", "#" and "/" as part of a token (Node.js, C++, CI/CD).
const B = "(?<![A-Za-z0-9_.+#/-])";
const E = "(?![A-Za-z0-9_+#-])";
const ci = (body: string) => new RegExp(`${B}(?:${body})${E}`, "i");
const cs = (body: string) => new RegExp(`${B}(?:${body})${E}`);

export const SKILLS: SkillDef[] = [
  // Languages
  { name: "JavaScript", category: "language", patterns: [ci("javascript|ecmascript|es6"), cs("JS")] },
  { name: "TypeScript", category: "language", patterns: [ci("typescript")] },
  { name: "Python", category: "language", patterns: [ci("python")] },
  { name: "Java", category: "language", patterns: [ci("java")] },
  { name: "Go", category: "language", patterns: [ci("golang"), /(?<![A-Za-z0-9_.])Go(?=\s*(?:,|\/|\)|;|$|\n|\s(?:and|or)\s+[A-Z]))/m] },
  { name: "C++", category: "language", patterns: [/(?<![A-Za-z0-9_])C\+\+/i] },
  { name: "C#", category: "language", patterns: [/(?<![A-Za-z0-9_])C#/i] },
  { name: "Rust", category: "language", patterns: [cs("Rust")] },
  { name: "Kotlin", category: "language", patterns: [ci("kotlin")] },
  { name: "Swift", category: "language", patterns: [cs("Swift")] },
  { name: "Ruby", category: "language", patterns: [cs("Ruby")] },
  { name: "PHP", category: "language", patterns: [ci("php")] },
  { name: "SQL", category: "language", patterns: [ci("sql")] },
  // Frontend
  { name: "React", category: "frontend", patterns: [cs("React(?:\\.js|JS)?"), ci("reactjs|react\\.js")] },
  { name: "Next.js", category: "frontend", patterns: [ci("next\\.?js")] },
  { name: "Vue", category: "frontend", patterns: [ci("vue(?:\\.js)?")] },
  { name: "Angular", category: "frontend", patterns: [cs("Angular(?:JS)?")] },
  { name: "HTML", category: "frontend", patterns: [ci("html5?")] },
  { name: "CSS", category: "frontend", patterns: [ci("css3?")] },
  { name: "Tailwind CSS", category: "frontend", patterns: [ci("tailwind(?:\\s*css)?")] },
  // Backend
  { name: "Node.js", category: "backend", patterns: [ci("node\\.?js|node")] },
  { name: "Express", category: "backend", patterns: [cs("Express(?:\\.js)?"), ci("express\\.js|expressjs")] },
  { name: "REST APIs", category: "backend", patterns: [cs("REST(?:ful)?(?:\\s+APIs?)?"), ci("restful(?:\\s+apis?)?|rest\\s+apis?")] },
  { name: "GraphQL", category: "backend", patterns: [ci("graphql")] },
  { name: "Django", category: "backend", patterns: [ci("django")] },
  { name: "Flask", category: "backend", patterns: [cs("Flask")] },
  { name: "FastAPI", category: "backend", patterns: [ci("fastapi")] },
  { name: "Spring Boot", category: "backend", patterns: [ci("spring\\s*boot")] },
  { name: "Microservices", category: "backend", patterns: [ci("micro-?services?")] },
  // Databases
  { name: "PostgreSQL", category: "database", patterns: [ci("postgres(?:ql)?|psql")] },
  { name: "MySQL", category: "database", patterns: [ci("mysql")] },
  { name: "MongoDB", category: "database", patterns: [ci("mongo(?:db)?")] },
  { name: "Redis", category: "database", patterns: [ci("redis")] },
  // Cloud & DevOps
  { name: "AWS", category: "cloud", patterns: [ci("aws|amazon web services")] },
  { name: "GCP", category: "cloud", patterns: [ci("gcp|google cloud(?: platform)?")] },
  { name: "Azure", category: "cloud", patterns: [ci("azure")] },
  { name: "Docker", category: "devops", patterns: [ci("docker")] },
  { name: "Kubernetes", category: "devops", patterns: [ci("kubernetes|k8s")] },
  { name: "Terraform", category: "devops", patterns: [ci("terraform")] },
  { name: "CI/CD", category: "devops", patterns: [ci("ci\\s*/\\s*cd")] },
  { name: "Linux", category: "devops", patterns: [ci("linux")] },
  { name: "Vercel", category: "cloud", patterns: [ci("vercel")] },
  { name: "Netlify", category: "cloud", patterns: [ci("netlify")] },
  { name: "Heroku", category: "cloud", patterns: [ci("heroku")] },
  { name: "Firebase", category: "cloud", patterns: [ci("firebase")] },
  // Tools
  { name: "Git", category: "tool", patterns: [ci("git")] },
  { name: "GitHub", category: "tool", patterns: [ci("github")] },
  { name: "Postman", category: "tool", patterns: [ci("postman")] },
  { name: "Jest", category: "tool", patterns: [cs("Jest")] },
  { name: "Figma", category: "tool", patterns: [ci("figma")] },
  // Data / ML
  { name: "Machine Learning", category: "data", patterns: [ci("machine learning"), cs("ML")] },
  { name: "TensorFlow", category: "data", patterns: [ci("tensorflow")] },
  { name: "PyTorch", category: "data", patterns: [ci("pytorch")] },
  { name: "Pandas", category: "data", patterns: [ci("pandas")] },
  // Practices
  { name: "Data Structures & Algorithms", category: "practice", patterns: [ci("data structures(?:\\s*(?:&|and)\\s*algorithms)?|dsa")] },
  { name: "Agile", category: "practice", patterns: [ci("agile|scrum")] },
];

const BY_NAME = new Map(SKILLS.map((s) => [s.name.toLowerCase(), s]));

export const getSkill = (name: string): SkillDef | undefined => BY_NAME.get(name.toLowerCase());

export interface SkillHit {
  name: string;
  index: number;
  length: number;
}

/** All dictionary skills mentioned in `text`, ordered by first appearance. */
export function findSkills(text: string): SkillHit[] {
  const hits: SkillHit[] = [];
  for (const skill of SKILLS) {
    let best: SkillHit | undefined;
    for (const re of skill.patterns) {
      const m = re.exec(text);
      if (m && (!best || m.index < best.index)) best = { name: skill.name, index: m.index, length: m[0].length };
    }
    if (best) hits.push(best);
  }
  // "Node" inside "Node.js", "CSS" inside "Tailwind CSS", "REST" in "RESTful" etc. are fine as separate
  // canonical skills, but drop hits fully contained in a longer hit of a *different* skill at the same spot
  // when the shorter one is only a fragment (e.g. "Git" is never a fragment of "GitHub" due to boundaries).
  return hits.sort((a, b) => a.index - b.index || b.length - a.length);
}

export const skillNames = (text: string): string[] => findSkills(text).map((h) => h.name);

export const mentionsSkill = (text: string, name: string): boolean => {
  const def = getSkill(name);
  return def ? def.patterns.some((re) => re.test(text)) : new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
};

/** Deployment platforms that count as *potentially relevant* evidence for cloud requirements. */
export const DEPLOYMENT_PLATFORMS = ["Vercel", "Netlify", "Heroku", "Firebase", "Render", "Railway", "DigitalOcean"];

export const CLOUD_PROVIDERS = ["AWS", "GCP", "Azure"];
