exports.requireSTRO = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }

  if (req.session.user.role !== "stro") {
    return res.status(403).send(
      "Access denied. STRO reviewer account required."
    );
  }

  return next();
};