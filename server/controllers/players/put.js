const Promise           = require("bluebird"),
      getConnection     = require("../../config/mysql");

module.exports = async (req, res) => {
  let query       = ``,
      queryData   = [],
      queryAdded  = false;

  if (!req.body.playerId)
    return res.status(400).json({ message: "missingFields"  });

  query = `UPDATE players SET `;

  if (req.body.firstName) {
    query += `firstName = ? `;
    queryData.push(req.body.firstName)
    queryAdded = true;
  }

  if (req.body.lastName) {
    if (queryAdded)
      query += `, `
    query += `lastName = ? `;
    queryData.push(req.body.lastName)
    queryAdded = true;
  }

  if (req.body.teamNumber) {
    if (queryAdded)
      query += `, `
    query += `teamNumber = ? `;
    queryData.push(req.body.teamNumber)
    queryAdded = true;
  }

  if (req.body.birthday) {
    if (queryAdded)
      query += `, `
    query += `birthday = ? `;
    queryData.push(req.body.birthday)
    queryAdded = true;
  }

  if (req.body.position) {
    if (queryAdded)
      query += `, `
    query += `position = ? `;
    queryData.push(req.body.position)
    queryAdded = true;
  }

  if (req.body.throwingArm) {
    if (queryAdded)
      query += `, `
    query += `throwingArm = ? `;
    queryData.push(req.body.throwingArm)
    queryAdded = true;
  }

  if (req.body.battingArm) {
    if (queryAdded)
      query += `, `
    query += `battingArm = ? `;
    queryData.push(req.body.battingArm)
    queryAdded = true;
  }

  if (req.body.phoneNumber) {
    if (queryAdded)
      query += `, `
    query += `phoneNumber = ? `;
    queryData.push(req.body.phoneNumber)
    queryAdded = true;
  }

  if (req.body.email) {
    // Validate email:
    if (!/@/.test(req.body.email))
      return res.status(400).json({ message: "emailErr" });

    if (queryAdded)
      query += `, `
    query += `email = ? `;
    queryData.push(req.body.email)
    queryAdded = true;
  }

  if (req.body.parentFirstName) {
    if (queryAdded)
      query += `, `
    query += `parentFirstName = ? `;
    queryData.push(req.body.parentFirstName)
    queryAdded = true;
  }

  if (req.body.parentLastName) {
    if (queryAdded)
      query += `, `
    query += `parentLastName = ? `;
    queryData.push(req.body.parentLastName)
    queryAdded = true;
  }

  if (!queryAdded)
    return res.status(200).json({ message: "emptyFields" });

  query += `updatedAt = NOW() WHERE teamId = (SELECT teamId FROM coaches WHERE userId = UNHEX(?) LIMIT 1) AND
    id = UNHEX(?) LIMIT 1`;

  queryData.push(req.user.id);
  queryData.push(req.body.playerId);

  Promise.using(getConnection(), connection => connection.execute(userQuery, userData))
    .then(data => res.end())
    .catch(error => {
      if (error.status)
        return res.status(error.status).json({ message: error.message });
      return res.status(400).json({ message: "admin", error: error });
    });
}
