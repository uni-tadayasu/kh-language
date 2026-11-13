"use strict";

function downloadPath(value) {
  if (typeof value !== "string") return null;
  return /^downloads\/[A-Za-z0-9_.-]+\.zip$/i.test(value) ? value : null;
}

function updatePackage(platform, metadata) {
  const href = downloadPath(metadata?.url);
  if (!href) return;
  document.querySelectorAll('[data-platform="' + platform + '"]').forEach(link => { link.href = href; });
  const hash = document.querySelector('[data-release-hash="' + platform + '"]');
  if (hash && /^[a-f0-9]{64}$/i.test(metadata.sha256)) hash.textContent = metadata.sha256;
  const bytes = document.querySelector('[data-release-size="' + platform + '"]');
  if (bytes && Number.isSafeInteger(metadata.bytes) && metadata.bytes > 0) {
    bytes.textContent = "約" + Math.round(metadata.bytes / 1024).toLocaleString("ja-JP") + " KiB";
  }
}

async function refreshRelease() {
  try {
    const response = await fetch("./release.json", { cache: "no-store" });
    if (!response.ok) return;
    const release = await response.json();
    if (!release || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(release.version)) return;
    document.querySelectorAll("[data-release-version]").forEach(node => { node.textContent = "v" + release.version; });
    const date = document.querySelector("#release-date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(release.date)) {
      date.dateTime = release.date;
      date.textContent = release.date.replaceAll("-", "/");
    }
    const notes = document.querySelector("#release-notes");
    if (notes && typeof release.notes === "string") notes.textContent = release.notes;
    updatePackage("windows", release.windows);
    updatePackage("portable", release.portable);
  } catch {
    // The shipped release remains downloadable during a network interruption.
  }
}

refreshRelease();
