const fs = require("fs");
const fetch = require("node-fetch");

const GITHUB_USER = "WSmithDR";
const README_PATH = "README.md";
const TEMPLATE_PATH = "README_TEMPLATE.md";

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

async function getRepos() {
  let repos = [];
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json();
    if (data.length === 0) break;
    repos = repos.concat(data);
    page++;
  }
  return repos;
}

function getPinnedProjects(repos) {
  const sorted = repos.filter(r => !r.fork).sort((a, b) => b.stargazers_count - a.stargazers_count);
  const top2 = sorted.slice(0, 2);
  if (top2.length === 0) return "No pinned projects yet.";
  return top2.map(repo =>
    `<a href=\"https://github.com/${GITHUB_USER}/${repo.name}\"><img src=\"https://github-readme-stats.vercel.app/api/pin/?username=${GITHUB_USER}&repo=${repo.name}&theme=algolia&title_color=00bfa5\" /></a>`
  ).join(" ");
}

function getTotalStars(repos) {
  return repos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
}

async function generateReadme() {
  try {
    const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const repos = await getRepos();
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
