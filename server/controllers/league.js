const jwt = require("jsonwebtoken");
const Promise = require("bluebird");
const bcrypt = Promise.promisifyAll(require("bcrypt"));
const uuid = require('uuid/v1');
const generator = require('generate-password');

const jwtKey = require("../../keys/keys").jwtKey;
const serverKeys = require("../../keys/keys");
const getConnection = require("../config/mysql");
const nodeMailer = require('../config/nodemailer');


module.exports = {
  get: (req, res) => {
    Promise.using(getConnection(), connection => {
      const query = "SELECT email, firstName, lastName, leagueName, " +
        "phoneNumber, city, state FROM leagues WHERE id = UNHEX(?) LIMIT 1";
      return connection.execute(query, [req.user.id]);
    }).spread(data => res.status(200).json(data[0]))
      .catch(error => res.status(400).json({ message: "Please contact an admin." }));
  },
  getAll: (req, res) => {
    Promise.using(getConnection(), connection => {
      const query = "SELECT leagueName, city, state FROM leagues";
      return connection.execute(query);
    }).spread(data => res.status(200).json(data))
      .catch(error => {
        return res.status(400).json({ message: "Please contact an admin." })
      });
  },
  update: (req, res) => {
    // Expecting all form data.
		if (
			!req.body.email ||
			!req.body.firstName ||
			!req.body.lastName ||
			!req.body.leagueName ||
			!req.body.phoneNumber ||
			!req.body.city ||
      !req.body.state
		)
			return res.status(400).json({ message: "All form fields are required." });

    // Validate email:
		if (!/[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/.test(req.body.email))
			return res.status(400).json({ message: "Invalid email. Email format should be: email@mailserver.com." });

    Promise.using(getConnection(), connection => {
      // Check if unique email and leagueId combo entered:
      const query = "SELECT leagueName, email FROM leagues WHERE email = ? AND id != UNHEX(?) LIMIT 1";
      return connection.execute(query, [req.body.email, req.user.id]);
    }).spread(user => {
      if (user.length === 1 && user[0].leagueName == req.body.leagueName)
        throw { status: 400, message: 'Email already associated with this league.'}

      const query = "UPDATE leagues SET email = ?, firstName = ?, lastName = ?, leagueName = ?, " +
        "phoneNumber = ?, city = ?, state = ?, updatedAt = NOW() WHERE id = UNHEX(?) LIMIT 1";
      const data = [req.body.email, req.body.firstName, req.body.lastName, req.body.leagueName, req.body.phoneNumber, req.body.city, req.body.state, req.user.id];
      return Promise.using(getConnection(), connection => connection.execute(query, data));
    }).then(() => res.end())
      .catch(error => {
        if (error.status)
          return res.status(error.status).json({ message: error.message });
        return res.status(400).json({ message: "Please contact an admin.", error: error });
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
			return res.status(400).json({ message: "Old password is incorrect." });
    // Validate new password:
		if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d$@$!%*?&](?=.{7,})/.test(req.body.newPassword))
			return res.status(400).json({
				message: "Password must be at least 8 characters long and " +
				"have a lowercase letter, an uppercase letter, and a number."
			});

    Promise.using(getConnection(), connection => {
			// Get password by id:
			const query = "SELECT password FROM leagues WHERE id = UNHEX(?) LIMIT 1";
			return connection.execute(query, [req.user.id]);
		}).spread(data => {
			if (data.length == 0)
				throw { status: 400, message: "Current password is incorrect." };
			// Check valid password:
			return bcrypt.compareAsync(req.body.oldPassword, data[0].password);
		}).then(isMatch => {
      if (!isMatch)
        throw { status: 400, message: "Current password is incorrect." };
      return bcrypt.genSaltAsync(10);
    }).then(salt => bcrypt.hashAsync(req.body.newPassword, salt))
      .then(hash => Promise.using(getConnection(), connection => {
        const query = "UPDATE leagues SET password = ?, updatedAt = NOW() WHERE id = UNHEX(?) LIMIT 1";
  			return connection.execute(query, [hash, req.user.id]);
      })).then(() => res.end())
      .catch(error => {
        if (error.status)
          return res.status(error.status).json({ message: error.message });
        return res.status(400).json({ message: "Please contact an admin." });
      });
	},
  reset: (req, res) => {
    // Validate reset data:
    if (!req.body.email || !req.body.leagueName || !req.body.city || !req.body.state)
      return res.status(400).json({ message: "All form fields are required." });

    // Validate email:
    if (!/[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/.test(req.body.email))
      return res.status(400).json({ message: "Invalid email. Email format should be: email@mailserver.com." });

    const password = generator.generate({ length: 10, strict: true, numbers: true });

    bcrypt.genSaltAsync(10)
      .then(salt => bcrypt.hashAsync(password, salt))
      .then(hash => Promise.using(getConnection(), connection => {
        const query = "UPDATE leagues SET password = ?, updatedAt = NOW() WHERE email = ? " +
        "AND leagueName = ? AND city = ? AND state = ? LIMIT 1";
        return connection.execute(query, [hash, req.body.email, req.body.leagueName, req.body.city, req.body.state]);
      }))
      .spread(data => Promise.using(getConnection(), connection => {
        let error = false;
        if (data.affectedRows == 0)
          error = true;
        const query = "SELECT * FROM leagues WHERE email = ? AND leagueName = ? AND city = ? AND state = ? LIMIT 1";
        return [connection.execute(query, [req.body.email, req.body.leagueName, req.body.city, req.body.state]), error];
      })).spread((data, error) => {
        if (data[0].length != 0 && error)
          throw { status: 400, message: "Please wait for your account to be validated before trying to reset your password." };
        else if (error)
          throw { status: 400, message: "There is no such email associated with this league." };
        data[0][0].password = password
        console.log(data[0][0]);
        return nodeMailer.resetLeaguePassword(data[0][0])
      }).then(email => {
        nodeMailer.mailOptions.to = req.body.email
        nodeMailer.mailOptions.subject = "Your password has been reset"
        nodeMailer.mailOptions.html = email
        return nodeMailer.transporter.sendMail(nodeMailer.mailOptions)
      })
      .then(info => res.status(200).json())
      .catch(error => {
        if (error.status)
          return res.status(error.status).json({ message: error.message });
        return res.status(400).json({ message: "Please contact an admin.", error: error});
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
			const query = "SELECT HEX(id) AS id, email, password, isLive FROM leagues WHERE email = ? AND leagueName = ? " +
      "AND city = ? AND state = ? LIMIT 1";
			return connection.execute(query, [req.body.email, req.body.leagueName, req.body.city, req.body.state]);
		}).spread(data => {
			if (data.length == 0)
				throw { status: 400, message: "Email/password/league name does not match." };

      if (data[0].isLive != 1)
        throw {  status: 400, message: "Account needs to be validated by the YouthDraft adminstration." }

			// Check valid password:
			return [bcrypt.compareAsync(req.body.password, data[0].password), data];
		}).spread((isMatch, data) => {
			if (!isMatch)
				throw { status: 400, message: "Email/password/league name does not match." };

			const youthDraftToken = jwt.sign({
				iat: Math.floor(Date.now() / 1000) - 30,
				id: data[0].id
			}, jwtKey);
			return res.status(200).json(youthDraftToken);
		}).catch(error => {
			if (error.status)
				return res.status(error.status).json({ message: error.message });
			return res.status(400).json({ message: "Please contact an admin.", error: error});
		});
	},
  validate: (req, res) => {
    if (!req.body.JWT)
      return res.status(400).json({ message: "This link is not valid." });
    let decoded = {};
    try {
      decoded = jwt.verify(req.body.JWT, jwtKey)
    } catch (error) {
      return res.status(400).json({ message: "This link is not valid." });
    }
    if (!decoded.youthdraftKey || decoded.youthdraftKey != serverKeys.youthdraftKey)
      return res.status(400).json({ message: "This link is not valid." });
    const password = generator.generate({ length: 10, strict: true, numbers: true  });
    bcrypt.genSaltAsync(10)
			.then(salt => bcrypt.hashAsync(password, salt))
			.then(hash => Promise.using(getConnection(), connection => {
        const query = "UPDATE leagues SET isLive = 1 , password = ?, updatedAt = NOW() WHERE id = UNHEX(?) " +
        "AND isLive != 1 LIMIT 1";
        return connection.execute(query, [hash, decoded.id]);
      })).spread(data => Promise.using(getConnection(), connection => {
        if (data.affectedRows == 0)
          throw { status: 400, message: "This league has already been validated." };

        const query = "SELECT * FROM leagues WHERE id = UNHEX(?) LIMIT 1";
        return connection.execute(query, [decoded.id]);
      })).spread(data => {
        data[0].password = password
        return [nodeMailer.verifyLeague(data[0]), data]
      }).spread((email, data) => {
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
  reject: (req, res) => {
    if (!req.body.JWT)
      return res.status(400).json({ message: "This link is not valid." });
    let decoded = {};
    try {
      decoded = jwt.verify(req.body.JWT, jwtKey)
    } catch (error) {
      return res.status(400).json({ message: "This link is not valid." });
    }
    if (!decoded.youthdraftKey || decoded.youthdraftKey != serverKeys.youthdraftKey)
      return res.status(400).json({ message: "This link is not valid." });
    Promise.using(getConnection(), connection => {
      const query = "SELECT * FROM leagues WHERE id = UNHEX(?) LIMIT 1";
      return connection.execute(query, [decoded.id]);
    }).spread(data => Promise.using(getConnection(), connection => {
      if (data.length == 0)
        throw { status: 400, message: "This league does not exist." };
      const query = "DELETE FROM leagues WHERE id = UNHEX(?) LIMIT 1";
      return [connection.execute(query, [decoded.id]), data];
    })).spread((dataDel, data) => {
      return [nodeMailer.rejectLeague(data[0]), data]
    }).spread((email, data) => {
      nodeMailer.mailOptions.to = data[0].email
      nodeMailer.mailOptions.subject = "Your account has been rejected/terminated"
      nodeMailer.mailOptions.html = email
      return nodeMailer.transporter.sendMail(nodeMailer.mailOptions)
    }).then(info => res.status(200).json())
    .catch(error => {
      if (error.status)
        return res.status(error.status).json({ message: error.message });
      return res.status(400).json({ message: "Please contact an admin." });
    });
  }
}
