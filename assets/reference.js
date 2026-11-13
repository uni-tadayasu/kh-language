"use strict";

const searchBar = document.querySelector("#ref-search-bar");
const search = document.querySelector("#ref-search");
const count = document.querySelector("#ref-count");
const groups = [...document.querySelectorAll("[data-group]")].map(section => ({
  section,
  entries: [...section.querySelectorAll("[data-entry]")].map(element => ({
    element, index: element.textContent.normalize("NFKC").toLowerCase()
  }))
}));

function filterReference() {
  const terms = search.value.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  let total = 0;
  for (const { section, entries } of groups) {
    let visible = 0;
    for (const { element, index } of entries) {
      const matches = terms.every(term => index.includes(term));
      element.hidden = !matches;
      if (matches) visible++;
    }
    total += visible;
    section.hidden = visible === 0;
  }
  count.textContent = total ? total + " 件" : "一致するコマンドがありません。";
}

function clearSearch() {
  search.value = "";
  filterReference();
}

search.addEventListener("input", filterReference);
document.querySelector("#ref-clear").addEventListener("click", () => {
  clearSearch();
  search.focus();
});
document.querySelectorAll(".ref-side a[href^='#']").forEach(link => {
  link.addEventListener("click", clearSearch);
});
filterReference();
searchBar.hidden = false;
