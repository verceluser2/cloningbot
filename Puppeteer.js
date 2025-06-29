const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cheerio = require("cheerio");
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const { URL } = require("url");

puppeteer.use(StealthPlugin());

(async () => {
  const siteUrl = "https://defi-mainnetsdapp.vercel.app";
  const outputDir = "cloned";
  const redirectURL = "https://google.com";

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(siteUrl, { waitUntil: "networkidle2" });

  const html = await page.content();
  const $ = cheerio.load(html);
  const baseHref = $('base').attr('href') || siteUrl;

  // === Save External CSS ===
  const cssLinks = $('link[rel="stylesheet"]');
  for (const el of cssLinks.toArray()) {
    const href = $(el).attr("href");
    if (href && !href.startsWith("data:")) {
      try {
        const fullUrl = new URL(href, baseHref).href;
        const res = await axios.get(fullUrl);
        const fileName = path.basename(new URL(href, baseHref).pathname).split("?")[0];
        const filePath = `css/${fileName}`;
        await fs.outputFile(path.join(outputDir, filePath), res.data);
        $(el).attr("href", filePath);
        console.log("📁 Saved CSS:", filePath);
      } catch (err) {
        console.warn("⚠️ Failed to fetch CSS:", href);
      }
    }
  }

  // === Save External JS ===
  const scripts = $('script[src]');
  for (const el of scripts.toArray()) {
    const src = $(el).attr("src");
    if (src && !src.startsWith("data:")) {
      try {
        const fullUrl = new URL(src, baseHref).href;
        const res = await axios.get(fullUrl);
        const fileName = path.basename(new URL(src, baseHref).pathname).split("?")[0];
        const filePath = `js/${fileName}`;
        await fs.outputFile(path.join(outputDir, filePath), res.data);
        $(el).attr("src", filePath);
        console.log("📁 Saved JS:", filePath);
      } catch (err) {
        console.warn("⚠️ Failed to fetch JS:", src);
      }
    }
  }

  // === Keep Image URLs Online ===
  const images = $('img[src]');
  for (const el of images.toArray()) {
    const src = $(el).attr("src");
    if (src && !src.startsWith("data:")) {
      const fullUrl = new URL(src, baseHref).href;
      $(el).attr("src", fullUrl);
      console.log("🌐 Linked Image:", fullUrl);
    }
  }

  // === Redirect all links ===
  $("a[href]").each((_, el) => {
    $(el).attr("href", redirectURL);
    $(el).removeAttr("target");
  });

  // === Redirect all <button> ===
  const buttonCount = $("button").length;
  $("button").each((_, el) => {
    $(el).attr("onclick", `window.location='${redirectURL}'`);
  });

  // === Style cursor:pointer inline ===
  let pointerCount = 0;
  $("[style]").each((_, el) => {
    const style = $(el).attr("style");
    if (style && style.toLowerCase().includes("cursor: pointer")) {
      $(el).attr("onclick", `window.location='${redirectURL}'`);
      pointerCount++;
    }
  });

  // === Classes with cursor:pointer ===
  const pointerClasses = new Set();
  $("style").each((_, el) => {
    const css = $(el).html();
    const matches = css.match(/\.(\w[\w-]*)\s*{[^}]*cursor\s*:\s*pointer[^}]*}/gi);
    if (matches) {
      matches.forEach(rule => {
        const classMatch = rule.match(/\.(\w[\w-]*)/);
        if (classMatch) pointerClasses.add(classMatch[1]);
      });
    }
  });

  for (const className of pointerClasses) {
    $(`.${className}`).attr("onclick", `window.location='${redirectURL}'`);
    pointerCount += $(`.${className}`).length;
  }

  console.log("🎯 Pointer-style elements redirected:", pointerCount);
  console.log("🔘 <button> elements redirected:", buttonCount);
  console.log("🔗 <a> links replaced with:", redirectURL);

  // === Save Final HTML ===
  await fs.outputFile(path.join(outputDir, "index.html"), $.html());
  console.log("✅ Done! Saved at cloned/index.html");

  await browser.close();
})();
