// backend/src/config/logger.js
require("dotenv").config();
const winston = require("winston");
require("winston-daily-rotate-file");
const { MongoDB } = require("winston-mongodb");

const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "white",
};

winston.addColors(colors);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    ({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`,
  ),
);

const fileFormat = winston.format.combine(
  winston.format.uncolorize(),
  winston.format.json(),
);

const transports = [
  new winston.transports.Console({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    format: consoleFormat,
  }),
  new winston.transports.DailyRotateFile({
    filename: "logs/application-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "14d",
    level: "info",
    format: fileFormat,
  }),
  new winston.transports.DailyRotateFile({
    filename: "logs/error-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "30d",
    level: "error",
    format: fileFormat,
  }),
];

if (process.env.MONGO_URI) {
  transports.push(
    new MongoDB({
      db: process.env.MONGO_URI,
      collection: "logs",
      level: "info",
      metaKey: "meta",
    }),
  );
}

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  levels,
  format: winston.format.json(),
  transports,
  exitOnError: false,
});

module.exports = logger;
