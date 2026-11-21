# Contributing

abstractCORE is early, and feedback on the model is as valuable as code.

- **Try the [demo](https://belovedtemitope.github.io/abstractCORE/demo/)** and open an issue for anything confusing, or any decision you'd expect to own that the model doesn't give you.
- **Design discussion**: proposals against [docs/architecture.md](docs/architecture.md), especially the file format and the AI integration interface.
- **Example projects**: a new `.acore.json` in `examples/` that stresses the model in a different domain is very welcome.

## Development

```bash
npm install
npm test          # type-check, build and run the test suite
npm run build     # compile src/ to dist/ (library + acore CLI)
npm run demo      # bundle demo/app.ts → demo/app.js
```

`demo/app.js` is generated and committed so the demo runs on GitHub Pages without a build step. Rebuild it when you change `src/` or `demo/app.ts`.

For larger changes, open an issue first so we can agree on direction, then send a pull request against `main`. By contributing you agree your work is licensed under the [Apache License 2.0](LICENSE).
