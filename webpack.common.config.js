const path = require("path");

module.exports = {
  entry: "./index.ts",
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
  output: {
    filename: "bundle.js",
    path: path.resolve(__dirname, "dist"),
  },
};
