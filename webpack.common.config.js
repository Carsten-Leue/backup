const { BannerPlugin } = require("webpack");
const path = require("path");

module.exports = {
  entry: "./src/bundle.ts",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "ts-loader",
          options: {
            configFile: "tsconfig.webpack.json",
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  target: "node",
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  plugins: [new BannerPlugin({ banner: "#!/usr/bin/env node", raw: true })],
  output: {
    filename: "bundle.js",
    path: path.resolve(__dirname, "dist"),
  },
};
