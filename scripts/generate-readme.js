const fs = require("fs");
const fetch = require("node-fetch");

const GITHUB_USER = process.env.GITHUB_USER || "WSmithDR";
const README_PATH = "README.md";
const TEMPLATE_PATH = "README_TEMPLATE.md";
const GITHUB_TOKEN = process.env.GH_TOKEN;

const fetchOptions = GITHUB_TOKEN
  ? { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
  : {};

async function fetchAllPages(url) {
  let results = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}` , fetchOptions);
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} (${url})`);
    const data = await res.json();
    if (data.length === 0) break;
    results = results.concat(data);
    page++;
  }
  return results;
}

async function getUserRepos() {
  return await fetchAllPages(`https://api.github.com/user/repos?type=all&sort=updated`);
}

async function getOrgs() {
  const orgs = await fetchAllPages(`https://api.github.com/user/orgs`);
  return orgs.map(org => org.login);
}

async function getOrgRepos(org) {
  return await fetchAllPages(`https://api.github.com/orgs/${org}/repos?type=all&sort=updated`);
}

async function getAllRepos() {
  let repos = await getUserRepos();
  const orgs = await getOrgs();
  for (const org of orgs) {
    const orgRepos = await getOrgRepos(org);
    repos = repos.concat(orgRepos);
  }
  const seen = new Set();
  const uniqueRepos = repos.filter(repo => {
    if (seen.has(repo.full_name)) return false;
    seen.add(repo.full_name);
    return true;
  });
  return uniqueRepos;
}

// NUEVA LÓGICA: Cuenta el número de proyectos por lenguaje
async function getTopLanguages(repos) {
  const langCount = {};
  repos.forEach(repo => {
    if (repo.language && !repo.fork && repo.owner.login.toLowerCase() === GITHUB_USER.toLowerCase()) {
      const lang = repo.language;
      langCount[lang] = (langCount[lang] || 0) + 1;
    }
  });

  const sorted = Object.entries(langCount).sort((a, b) => b[1] - a[1]);
  
  // Genera badges de shields.io indicando "Lenguaje - N Proyectos"
  const badges = sorted
    .map(([lang, count]) => {
      const encodedLang = encodeURIComponent(lang);
      const label = count === 1 ? 'Project' : 'Projects';
      return `<img src="https://img.shields.io/badge/${encodedLang}-${count}_${label}-00bfa5?style=flat-square" />`;
    })
    .join(" ");
    
  return badges || "No languages detected yet";
}

function getPinnedProjects(repos) {
  const sorted = repos.filter(
    r => !r.fork && !r.private && r.owner.login.toLowerCase() === GITHUB_USER.toLowerCase()
  ).sort((a, b) => b.stargazers_count - a.stargazers_count);
  const top2 = sorted.slice(0, 2);
  if (top2.length === 0) return "No pinned projects yet.";
  return top2.map(repo =>
    `<a href="https://github.com/${repo.full_name}"><img src="https://github-readme-stats.vercel.app/api/pin/?username=${repo.owner.login}&repo=${repo.name}&theme=algolia&title_color=00bfa5" /></a>`
  ).join(" ");
}

// LÓGICA CORREGIDA: Solo suma estrellas de tus propios repositorios
function getTotalStars(repos) {
  return repos.reduce((sum, repo) => {
    if (!repo.fork && repo.owner.login.toLowerCase() === GITHUB_USER.toLowerCase()) {
      return sum + (repo.stargazers_count || 0);
    }
    return sum;
  }, 0);
}

async function getLatestProjects(repos, n = 5) {
  const sorted = repos.filter(r => !r.fork && !r.private && r.owner.login.toLowerCase() === GITHUB_USER.toLowerCase())
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return sorted.slice(0, n).map(repo =>
    `<li><a href="https://github.com/${repo.full_name}">${repo.name}</a> - ${repo.description || "No description"}</li>`
  ).join("\n");
}

function getSkillsProgress(repos) {
  const langCount = {};
  let total = 0;
  repos.forEach(repo => {
    if (repo.language && !repo.fork && !repo.private && repo.owner.login.toLowerCase() === GITHUB_USER.toLowerCase()) {
      const lang = repo.language;
      langCount[lang] = (langCount[lang] || 0) + 1;
      total++;
    }
  });
  const sorted = Object.entries(langCount).sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 8).map(([lang, count]) => {
    const percent = ((count / total) * 100).toFixed(1);
    return `<b>${lang}</b> <progress value="${percent}" max="100"></progress> ${percent}%`;
  }).join("<br>\n");
}

async function generateReadme() {
  try {
    const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const repos = await getAllRepos();
    
    const techIcons = await getTopLanguages(repos);
    const pinned = getPinnedProjects(repos);
    const totalStars = getTotalStars(repos);
    const latestProjects = await getLatestProjects(repos);
    const skillsProgress = getSkillsProgress(repos);

    const output = template
      .replace(/{{TECH_STACK_ICONS}}/g, techIcons)
      .replace(/{{PINNED_PROJECTS}}/g, pinned)
      .replace(/{{TOTAL_STARS}}/g, totalStars)
      .replace(/{{GITHUB_USER}}/g, GITHUB_USER)
      .replace(/{{LATEST_PROJECTS}}/g, latestProjects)
      .replace(/{{SKILLS_PROGRESS}}/g, skillsProgress);

    fs.writeFileSync(README_PATH, output);
    console.log("README.md updated successfully!");
  } catch (err) {
    console.error("Error generating README:", err);
    process.exit(1);
  }
}

generateReadme();
