const { z } = require("zod");

function validateBody(schema) {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }

      req.body = result.data;
      return next();
    } catch (e) {
      return next(e);
    }
  };
}

module.exports = { z, validateBody };
