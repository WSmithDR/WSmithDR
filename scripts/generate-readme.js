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
  // Get user repos
  let repos = await getUserRepos();
  // Get org repos
  const orgs = await getOrgs();
  for (const org of orgs) {
    const orgRepos = await getOrgRepos(org);
    repos = repos.concat(orgRepos);
  }
  // Remove duplicates by full_name
  const seen = new Set();
  const uniqueRepos = repos.filter(repo => {
    if (seen.has(repo.full_name)) return false;
    seen.add(repo.full_name);
    return true;
  });
  return uniqueRepos;
}

async function getTopLanguages(repos) {
  const languageSet = new Set();
  repos.forEach(repo => {
    if (repo.language) languageSet.add(repo.language.toLowerCase());
  });
  const icons = Array.from(languageSet)
    .map(lang => `<img src=\"https://skillicons.dev/icons?i=${lang}\" height=\"40\" style=\"margin: 0 5px;\"/>`)
    .join(" ");
  return icons || "No languages detected yet";
}

function getRandomAnimeQuote() {
  const quotes = [
    "Power comes in response to a need, not a desire. - Goku",
    "A lesson without pain is meaningless. - Fullmetal Alchemist",
    "When you give up, your dreams and everything else they're gone. - Naruto",
    "Whatever you lose, you'll find it again. But what you throw away you'll never get back. - Kenshin",
    "It's not the face that makes someone a monster; it's the choices they make with their lives. - Naruto",
    "To know sorrow is not terrifying. What is terrifying is to know you can't go back to happiness you could have. - Matsumoto Rangiku"
  ];
  return quotes[Math.floor(Math.random() * quotes.length)];
}

function getPinnedProjects(repos) {
  // Solo repos públicos y del usuario principal
  const sorted = repos.filter(
    r => !r.fork && !r.private && r.owner.login.toLowerCase() === GITHUB_USER.toLowerCase()
  ).sort((a, b) => b.stargazers_count - a.stargazers_count);
  const top2 = sorted.slice(0, 2);
  if (top2.length === 0) return "No pinned projects yet.";
  return top2.map(repo =>
    `<a href=\"https://github.com/${repo.full_name}\"><img src=\"https://github-readme-stats.vercel.app/api/pin/?username=${repo.owner.login}&repo=${repo.name}&theme=algolia&title_color=00bfa5\" /></a>`
  ).join(" ");
}

function getTotalStars(repos) {
  return repos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
}

async function generateReadme() {
  try {
    const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const repos = await getAllRepos();
    const techIcons = await getTopLanguages(repos);
    const quote = getRandomAnimeQuote();
    const pinned = getPinnedProjects(repos);
    const totalStars = getTotalStars(repos);

    const output = template
      .replace("{{TECH_STACK_ICONS}}", techIcons)
      .replace("{{ANIME_QUOTE}}", quote)
      .replace("{{PINNED_PROJECTS}}", pinned)
      .replace("{{TOTAL_STARS}}", totalStars);

    fs.writeFileSync(README_PATH, output);
    console.log("README.md updated successfully!");
  } catch (err) {
    console.error("Error generating README:", err);
    process.exit(1);
  }
}

generateReadme();
