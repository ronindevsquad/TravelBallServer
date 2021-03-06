const Promise           = require("bluebird"),
      getConnection     = require("../../config/mysql"),
      crypto            = require('crypto');

module.exports = async (req, res) => {
  let query       = ``,
      queryData   = [];

  if (!req.body.name)
    return res.status(400).json({ message: "missingFields"  });

  query = `INSERT INTO teams SET id = UNHEX(?), name = ?, street = ?, city = ?, state = ?, zip = ?, country = ?,
    createdAt = NOW(), updatedAt = NOW()`;

  query2 = `INSERT INTO coaches SET userId = UNHEX(?), teamId = UNHEX(?), coachType = 101, createdAt = NOW(),
    updatedAt = NOW()`;

  const id = crypto.randomBytes(16).toString('hex')

  queryData = [
    id,
    req.body.name,
    req.body.street ? req.body.street : null,
    req.body.city ? req.body.city : null,
    req.body.state ? req.body.state : null,
    req.body.zip ? req.body.zip : null,
    req.body.country ? req.body.country : null,
  ];

  query2 = [ req.user.id, id ]

  Promise.using(getConnection(), connection => connection.execute(query, queryData))
    .then(() => Promise.using(getConnection(), connection => connection.execute(query2, queryData2)))
    .then(data => res.status(200).json(id))
    .catch(error => {
      if (error.status)
        return res.status(error.status).json({ message: error.message });
      return res.status(400).json({ message: "admin", error: error });
    });
}
