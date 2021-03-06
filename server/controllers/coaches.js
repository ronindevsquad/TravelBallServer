const jwt = require("jsonwebtoken");
const Promise = require("bluebird");
const bcrypt = Promise.promisifyAll(require("bcrypt"));
const uuid = require('uuid/v1');
const xlsxConverter = require('../services/xlsx-converter');
const generator = require('generate-password');

const jwtKey = require("../../keys/keys").jwtKey;
const getConnection = require("../config/mysql");
const nodeMailer = require('../config/nodemailer');


module.exports = {
  getAll: (req, res) => {
    if (req.user.leagueId) {
      return res.status(400).json({ message: "You must be a league admin to use this route." })
    }
    Promise.using(getConnection(), connection => {
      const query = "SELECT HEX(a.id) as id, firstName, lastName, email, coachType, a.division, phoneNumber, birthday, " +
        "gender, address, city, state, zip, validated, a.createdAt, a.updatedAt, HEX(a.leagueId) as leagueId, " +
        "HEX(teamId) as teamId, b.name as teamName, b.division as teamDivision FROM coaches a LEFT JOIN teams as" +
        " b ON a.teamId = UNHEX(b.id) WHERE a.leagueId = UNHEX(?)";
      return connection.execute(query, [req.user.id]);
    }).spread(data => res.status(200).json(data))
      .catch(error => res.status(400).json({ message: "Please contact an admin.", error: error }));
	},
  get: (req, res) => {
    if (!req.user.leagueId) {
      return res.status(400).json({ message: "You must be a coach to use this route." })
    }
    Promise.using(getConnection(), connection => {
      const query = "SELECT HEX(a.id) as id, firstName, lastName, email, coachType, a.division, phoneNumber, birthday, " +
        "gender, address, city, state, zip, validated, a.createdAt, a.updatedAt, HEX(a.leagueId) as leagueId, " +
        "HEX(teamId) as teamId, b.name as teamName, b.division as teamDivision FROM coaches a LEFT JOIN teams as " +
        "b ON a.teamId = UNHEX(b.id) WHERE a.leagueId = UNHEX(?) AND a.id = UNHEX(?) LIMIT 1";
      return connection.execute(query, [req.user.leagueId, req.user.id]);
    }).spread(data => res.status(200).json(data[0]))
      .catch(error => res.status(400).json({ message: "Please contact an admin." }));
	},
  reset: (req, res) => {
    // Validate reset data:
		if (!req.body.email  || !req.body.leagueName || !req.body.city || !req.body.state)
			return res.status(400).json({ message: "All form fields are required." });

    // Validate email:
    if (!/[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/.test(req.body.email))
      return res.status(400).json({ message: "Invalid email. Email format should be: email@mailserver.com." });

    const password = generator.generate({ length: 10, strict: true, numbers: true  });

    bcrypt.genSaltAsync(10)
			.then(salt => bcrypt.hashAsync(password, salt))
			.then(hash => Promise.using(getConnection(), connection => {
        const query = "UPDATE coaches SET password = ?, updatedAt = NOW() WHERE email = ? AND leagueId = (SELECT id " +
          "FROM leagues WHERE leagueName = ? AND city = ? AND state = ? LIMIT 1) AND validated = 1 LIMIT 1";
        return connection.execute(query, [hash, req.body.email, req.body.leagueName, req.body.city, req.body.state]);
      }))
      .spread(data => Promise.using(getConnection(), connection => {
        let error = false;
        if (data.affectedRows == 0)
          error = true;
        const query = "SELECT * FROM coaches WHERE email = ? AND leagueId =  (SELECT id FROM leagues WHERE leagueName = ? " +
          "AND city = ? AND state = ? LIMIT 1) LIMIT 1";
        return [connection.execute(query, [req.body.email, req.body.leagueName, req.body.city, req.body.state]), error];
      })).spread((data, error) => {
        if (data[0].length != 0 && error)
          throw { status: 400, message: "Please wait for your account to be validated before trying to reset your password." };
        else if (error)
          throw { status: 400, message: "There is no such email associated with this league." };
        data[0].password = password;
        return nodeMailer.resetCoachPassword(data[0]);
      }).then(email => {
        nodeMailer.mailOptions.to = req.body.email;
        nodeMailer.mailOptions.subject = "Your password has been reset";
        nodeMailer.mailOptions.html = email;
        return nodeMailer.transporter.sendMail(nodeMailer.mailOptions);
      }).then(info => res.status(200).json())
      .catch(error => {
        if (error.status)
          return res.status(error.status).json({ message: error.message });
        return res.status(400).json({ message: "Please contact an admin.", error: error});
      });
  },
  coaches: (req, res) => {
    // Expecting all form data.
		if (
      req.user.leagueId && (
  			(!req.body.email) ||
  			(!req.body.firstName) ||
  			(!req.body.lastName) ||
  			(!req.body.phoneNumber) ||
        (!req.body.birthday) ||
        (!req.body.gender) ||
        (!req.body.address) ||
  			(!req.body.city) ||
        (!req.body.state) ||
        (!req.body.zip)
      ) || !req.user.leagueId && (
        (!req.body.coachType) ||
        (!req.body.teamId) ||
        (!req.body.division)
      )
		)
			return res.status(400).json({ message: "All form fields are required." });

    if (req.user.leagueId) {
      // Validate phone number:
  		if (!/^\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$/.test(req.body.phoneNumber))
  			return res.status(400).json({ message: "Invalid phone number.  Phone number format should be XXX-XXX-XXXX" });

      // Validate email:
  		if (!/[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/.test(req.body.email))
  			return res.status(400).json({ message: "Invalid email. Email format should be: email@mailserver.com." });
    }

    let query = "UPDATE coaches SET ";
    const data = [];

    if (!req.user.leagueId) {
      query += "coachType = ?, division = ?, teamId = UNHEX(?), "
      data.push(req.body.coachType);
      data.push(req.body.division);
      data.push(req.body.teamId);
      data.push(req.params.id);
      data.push(req.user.id);
    } else {
      query += "email = ?, firstName = ?, lastName = ?, phoneNumber = ?, birthday = ?, " +
        "gender = ?, address = ?, city = ?, state = ?, zip =?, "
      data.push(req.body.email);
      data.push(req.body.firstName);
      data.push(req.body.lastName);
      data.push(req.body.phoneNumber);
      data.push(req.body.birthday);
      data.push(req.body.gender);
      data.push(req.body.address);
      data.push(req.body.city);
      data.push(req.body.state);
      data.push(req.body.zip);
      data.push(req.user.id);
      data.push(req.user.leagueId);
    }
    query += "updatedAt = NOW() WHERE id = UNHEX(?) and leagueId = UNHEX(?) LIMIT 1";
    console.log(query, data);
    Promise.using(getConnection(), connection => connection.execute(query, data))
    .then(() => res.end())
    .catch(error => {
      if (error.status)
        return res.status(error.status).json({ message: error.message });
      return res.status(400).json({ message: "Please contact an admin." });
    });
	},
  createCoaches: (req, res) => {
    // Expecting all form data.
		if (
      !req.body.coachType ||
			!req.body.email ||
			!req.body.firstName ||
			!req.body.lastName ||
			!req.body.phoneNumber ||
      !req.body.division ||
      !req.body.birthday ||
      !req.body.gender ||
      !req.body.address ||
			!req.body.city ||
      !req.body.state ||
      !req.body.zip ||
      !req.body.teamId
		)
			return res.status(400).json({ message: "All form fields are required." });

    if (req.user.leagueId)
      return res.status(400).json({ message: "Only a league Admin can add a pre verified coach" });

    // Validate phone number:
		if (!/^\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$/.test(req.body.phoneNumber))
			return res.status(400).json({ message: "Invalid phone number.  Phone number format should be XXX-XXX-XXXX" });

    // Validate email:
		if (!/[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/.test(req.body.email))
			return res.status(400).json({ message: "Invalid email. Email format should be: email@mailserver.com." });

    const password = generator.generate({ length: 10, strict: true, numbers: true  });
    bcrypt.genSaltAsync(10)
			.then(salt => bcrypt.hashAsync(password, salt))
			.then(hash => Promise.using(getConnection(), connection => {
        const query = "INSERT INTO coaches SET id = UNHEX(?), email = ?, coachType = ?, firstName = ?, lastName = ?, " +
          "phoneNumber = ?, division = ?, birthday = ?, gender = ?, address = ?, city = ?, state = ?, zip =?, " +
          "password = ?, validated = 1, updatedAt = NOW(), createdAt = NOW(), teamId = UNHEX(?), leagueId = UNHEX(?)";
        const data = [
          uuid().replace(/\-/g, ""),
          req.body.email,
          req.body.coachType,
          req.body.firstName,
          req.body.lastName,
          req.body.phoneNumber,
          req.body.division,
          req.body.birthday,
          req.body.gender,
          req.body.address,
          req.body.city,
          req.body.state,
          req.body.zip,
          hash,
          req.body.teamId,
          req.user.id
        ];
        return connection.execute(query, data);
      })).spread(coachData => {
        const query = "SELECT * FROM leagues WHERE id = UNHEX(?)"
        return coachData, connection.execute(query, [req.user.id]);
      }).spread(data => {
        req.body.leagueFirstName = data[0].leagueFirstName;
        req.body.leagueLastName = data[0].leagueLastName;
        req.body.leagueName = data[0].leagueName;
        req.body.leagueCity = data[0].city;
        req.body.leagueState = data[0].state;
        return nodeMailer.createCoachEmail(req.body);
      }).then(email => nodeMailer.transporter.sendMail(email))
      .then(info => res.status(200).json())
      .catch(error => {
        return res.status(400).json({ message: "Please contact an admin.", error: error });
      });
  },
  register: (req, res) => {
    let query2;
    const data2 = [];
    // Expecting all form data.
		if (
			!req.body.email ||
			!req.body.firstName ||
			!req.body.lastName ||
			!req.body.phoneNumber ||
      !req.body.division ||
      !req.body.birthday ||
      !req.body.gender ||
      !req.body.address ||
			!req.body.city ||
      !req.body.state ||
      !req.body.zip ||
      (!req.body.yearsExperience && req.body.yearsExperience != 0) ||
      !req.body.pastDivisions ||
      !req.body.leagueName ||
      !req.body.leagueCity ||
      !req.body.leagueState
		)
			return res.status(400).json({ message: "All form fields are required." });

    // Validate phone number:
		if (!/^\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$/.test(req.body.phoneNumber))
			return res.status(400).json({ message: "Invalid phone number.  Phone number format should be XXX-XXX-XXXX" });

    // Validate email:
		if (!/[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/.test(req.body.email))
			return res.status(400).json({ message: "Invalid email. Email format should be: email@mailserver.com." });

    const id = uuid().replace(/\-/g, "")

    //Setup the query
    const query = "INSERT INTO coaches SET id = UNHEX(?), email = ?, firstName = ?, lastName = ?, phoneNumber = ?, " +
      "division = ?, birthday = ?, gender = ?, address = ?, city = ?, state = ?, zip =?, yearsExperience = ?, pastLeague = ?, " +
      "validated = 0, updatedAt = NOW(), createdAt = NOW(), leagueId = (SELECT id FROM leagues WHERE leagueName = ? " +
      "AND city = ? AND state = ? LIMIT 1)";
    const data = [
      id,
      req.body.email,
      req.body.firstName,
      req.body.lastName,
      req.body.phoneNumber,
      req.body.division,
      req.body.birthday,
      req.body.gender,
      req.body.address,
      req.body.city,
      req.body.state,
      req.body.zip,
      req.body.yearsExperience,
      req.body.pastLeague,
      req.body.leagueName,
      req.body.leagueCity,
      req.body.leagueState
    ];

    const tempData = req.body.pastDivisions
    const tempLength = tempData.length
    // Make sure the amount of data being inserted is not ridiculous
    if (tempLength > 0 && tempLength < 10 ) {
      query2 = "INSERT INTO coachPastDivisions (coachId, division, createdAt, updatedAt) VALUES ?"
      for (let i = 0; i < tempLength; i++) {
        data2.push([new Buffer(id, "hex"), tempData[i], "NOW()", "NOW()"])
      }
    } else {
      return res.status(400).json({ message: "There were too many past divisions.  Something went wrong.  Please try again." });
    }

    Promise.using(getConnection(), connection => connection.execute(query, data))
    .then(() => {
      if (query2)
      console.log(data2);
        return Promise.using(getConnection(), connection => connection.query(query2, [data2]));
    })
    .then(() => res.end())
    .catch(error => {
			if (error["code"] == "ER_DUP_ENTRY")
				return res.status(400).json({ message: "Email already associated with this league." });
			return res.status(400).json({ message: "Please contact an admin.", error:error});
		});
	},
  login: (req, res) => {
		// Validate login data:
    if (!req.body.email || !req.body.password || !req.body.leagueName || !req.body.city || !req.body.state)
			return res.status(400).json({ message: "All form fields are required." });

		// Pre-validate password:
		if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d$@$!%*?&](?=.{7,})/.test(req.body.password))
			return res.status(400).json({ message: "Email/password/league name does not match." });

		Promise.using(getConnection(), connection => {
			// Get user by email:
			const query = "SELECT HEX(b.id) AS id, b.email as email, b.password as password, b.validated as validated, " +
        "HEX(b.leagueId) as leagueId FROM leagues as a INNER JOIN coaches as b ON a.id = b.leagueId WHERE b.email = ? " +
        "AND a.leagueName = ? AND a.city = ? AND a.state = ? LIMIT 1";
			return connection.execute(query, [req.body.email, req.body.leagueName, req.body.city, req.body.state]);
		}).spread(data => {
			if (data.length == 0)
				throw { status: 400, message: "Email/password/league name does not match." };

      if (data[0].validated != 1)
        throw { status: 400, message: "Your account has not been validated." };

			// Check valid password:
			return [bcrypt.compareAsync(req.body.password, data[0].password), data];
		}).spread((isMatch, data) => {
			if (!isMatch)
				throw { status: 400, message: "Email/password/league name does not match." };
      console.log(req.body.leagueId);
			const gametimeToken = jwt.sign({
				iat: Math.floor(Date.now() / 1000) - 30,
				id: data[0].id,
        leagueId: data[0].leagueId,
			}, jwtKey);
			return res.status(200).json(gametimeToken);
		}).catch(error => {
			if (error.status)
				return res.status(error.status).json({ message: error.message });
			return res.status(400).json({ message: "Please contact an admin.", error:error});
		});
	},
  password: (req, res) => {
    // Check if form data is filled:
    if (!req.body.oldPassword  || !req.body.newPassword) {
      return res.status(400).json({ message: "Both password field should be filled" });
    }
    // Check if password match each other:
    if (req.body.oldPassword === req.body.newPassword) {
      return res.status(400).json({ message: "Old password and new password should not match." });
    }
    // Pre-validate old password:
		if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d$@$!%*?&](?=.{7,})/.test(req.body.oldPassword))
			return res.status(400).json({ message: "Current password is incorrect." });
    // Validate new password:
		if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d$@$!%*?&](?=.{7,})/.test(req.body.newPassword))
			return res.status(400).json({
				message: "Password must be at least 8 characters long and " +
				"have a lowercase letter, an uppercase letter, and a number."
			});

    Promise.using(getConnection(), connection => {
			// Get password by id:
			const query = "SELECT password FROM coaches WHERE id = UNHEX(?) LIMIT 1";
			return connection.execute(query, [req.user.id]);
		}).spread(data => {
			if (data.length == 0)
				throw { status: 400, message: "Current password is incorrect." };
			// Check valid password:
			return bcrypt.compareAsync(req.body.oldPassword, data[0].password)
		}).then(isMatch => {
      if (!isMatch)
        throw { status: 400, message: "Current password is incorrect." };
      return bcrypt.genSaltAsync(10);
    }).then(salt => bcrypt.hashAsync(req.body.newPassword, salt))
      .then(hash => Promise.using(getConnection(), connection => {
        const query = "UPDATE coaches SET password = ?, updatedAt = NOW() WHERE id = UNHEX(?) LIMIT 1";
  			return connection.execute(query, [hash, req.user.id]);
      }))
      .then(() => res.status(200).json())
      .catch(error => {
        if (error.status)
          return res.status(error.status).json({ message: error.message });
        return res.status(400).json({ message: "Please contact an admin."});
      });
	},
  validate: (req, res) => {
    const password = generator.generate({ length: 10, strict: true, numbers: true  });
    bcrypt.genSaltAsync(10)
			.then(salt => bcrypt.hashAsync(password, salt))
			.then(hash => Promise.using(getConnection(), connection => {
        const query = "UPDATE coaches SET validated = 1 , password = ?, updatedAt = NOW() WHERE id = UNHEX(?) " +
        "AND leagueId = UNHEX(?) AND validated != 1 LIMIT 1";
        return connection.execute(query, [hash, req.params.id, req.user.id]);
      }))
      .spread(data => Promise.using(getConnection(), connection => {
        if (data.affectedRows == 0)
          throw { status: 400, message: "This coach has already been validated." };

        const query = `SELECT a.firstName firstName, a.lastName lastName, a.email email, leagueName, b.city leagueCity,
          b.state leagueState, b.email leagueEmail FROM coaches a LEFT JOIN leagues b ON a.leagueId = b.id WHERE
          a.id = UNHEX(?) AND leagueId = UNHEX(?) LIMIT 1`;
        return connection.execute(query, [req.params.id, req.user.id]);
      })).spread(data => {
        data[0].password = password;
        return [nodeMailer.verifyCoachEmail(data[0]), data];
      }).spread((email, data) => {
        console.log("works");
        nodeMailer.mailOptions.to = data[0].email
        nodeMailer.mailOptions.subject = "Your account has been validated"
        nodeMailer.mailOptions.html = email
        return nodeMailer.transporter.sendMail(nodeMailer.mailOptions)
      }).then(info => res.status(200).json())
      .catch(error => {
        if (error.status)
          return res.status(error.status).json({ message: error.message });
        return res.status(400).json({ message: "Please contact an admin." });
      });
  },
  delete: (req, res) => {
    Promise.using(getConnection(), connection => {
      const query = `SELECT a.firstName firstName, a.lastName lastName, a.email email, leagueName, b.city leagueCity,
        b.state leagueState, b.email leagueEmail FROM coaches a LEFT JOIN leagues b ON a.leagueId = b.id WHERE
        a.id = UNHEX(?) AND leagueId = UNHEX(?) LIMIT 1`;
      return connection.execute(query, [req.params.id, req.user.id]);
    }).spread(data => Promise.using(getConnection(), connection => {
      if (data.length == 0)
        throw { status: 400, message: "This coach does not exist." };

      const query = "DELETE FROM coaches WHERE id = UNHEX(?) AND leagueId = UNHEX(?)";
      return [connection.execute(query, [req.params.id, req.user.id]), data];
    })).spread((dataDel, data) => {
      return [nodeMailer.rejectCoachEmail(data[0]), data]
    }).spread((email, data) => {
      nodeMailer.mailOptions.to = data[0].email
      nodeMailer.mailOptions.subject = "Your account has been rejected/terminated"
      nodeMailer.mailOptions.html = email
      return nodeMailer.transporter.sendMail(nodeMailer.mailOptions)
    }).then(info => res.status(200).json())
    .catch(error => {
      if (error.status)
        return res.status(error.status).json({ message: error.message });
      return res.status(400).json({ message: "Please contact an admin."});
    });
	}
}
