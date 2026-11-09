export {}
const result = await Bun.build({
  entrypoints: ["src/client/main.tsx", "src/client/mobile.tsx"],
  outdir: "public",
  target: "browser",
  minify: false,
  sourcemap: "linked",
})

if (!result.success) {
  console.error("Client-Build fehlgeschlagen")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log("Client gebaut: public/main.js, public/mobile.js")
