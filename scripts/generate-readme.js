const fs = require("fs");
const fetch = require("node-fetch");

const GITHUB_USER = "WSmithDR";
const README_PATH = "README.md";
const TEMPLATE_PATH = "README_TEMPLATE.md";

async function getTopLanguages() {
  const res = await fetch(`https://api.github.com/users/${GITHUB_USER}/repos`);
  const repos = await res.json();

  const languageSet = new Set();
  repos.forEach(repo => {
    if (repo.language) languageSet.add(repo.language.toLowerCase());
  });

  const icons = Array.from(languageSet)
    .map(lang => `<img src="https://skillicons.dev/icons?i=${lang}" />`)
    .join(" ");

  return icons || "No languages detected yet";
}

function getRandomAnimeQuote() {
  const quotes = [
    "Power comes in response to a need, not a desire. - Goku",
    "A lesson without pain is meaningless. - Fullmetal Alchemist",
    "When you give up, your dreams and everything else they're gone. - Naruto",
    "Whatever you lose, you'll find it again. But what you throw away you'll never get back. - Kenshin"
  ];
  return quotes[Math.floor(Math.random() * quotes.length)];
}

async function generateReadme() {
  const template = fs.readFileSync("README_TEMPLATE.md", "utf8");

  const techIcons = await getTopLanguages();
  const quote = getRandomAnimeQuote();

  const output = template
    .replace("{{TECH_STACK_ICONS}}", techIcons)
    .replace("{{ANIME_QUOTE}}", quote);

  fs.writeFileSync(README_PATH, output);
  console.log("README.md updated successfully!");
}

generateReadme();
