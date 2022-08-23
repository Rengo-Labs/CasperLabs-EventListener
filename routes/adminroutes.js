var express = require("express");
var router = express.Router();
require("dotenv").config();
const AdminModel = require("../models/adminModel");
const bcrypt = require("bcrypt");
const { BCRYPT_SALT_ROUNDS } = require("../config/bcrypt");
const jwtUtil = require("../utils/jwt");

/**
 * @swagger
 * components:
 *   schemas:
 *     Admin:
 *       type: object
 *       required:
 *         - username
 *         - password
 *       properties:
 *         username:
 *           type: string
 *           description: The username of the user
 *         password:
 *           type: string
 *           description: The password of the user      
 */

/**
 * @swagger
 * /adminsignup:
 *   post:
 *     description: This endpoint is used to signup as an admin into the system. This endpoint is not exposed as default, all the trusted people who have access to the listener backend repo can uncomment the adminsignup endpoint and use it to add new admin.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string  
 *           examples:
 *             '1':
 *               value: "{\r\n    \"username\":\"DavidTai123\",\r\n      \"password\":\"David123\"\r\n}"
 *             '2':
 *               value: "{\r\n        \"password\":\"David123\"\r\n}"
 *     responses:
 *       200:
 *         description: Admin Successfully Signed-up
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                               "success": true,
 *                               "errorCode": 0,
 *                               "errorMessage": "",
 *                               "error": null
 *                           },
 *                           "body": {
 *                              "message":"Admin Successfully Signed-up"
 *                           }
 *                       }  
 *       400:
 *         description: if any parameter not found in the body
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 400,
 *                             "errorMessage": "Username not found in the request body!",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         }
 */

// router.post("/adminsignup", async function (req, res, next) {
//   try {

//     if (!req.body.username) {
//       return res.status(400).json({
//         success: false,
//         message: "username not found in the request body!",
//       });
//     }
//     if (!req.body.password) {
//         return res.status(400).json({
//         success: false,
//         message: "Password not found in the request body!",
//         });
//     }

//     var usernamecheck = await AdminModel.findOne({ username: req.body.username });
//     if (usernamecheck) {
//       return res.status(400).json({
//         success: false,
//         message: "This Admin already exists.",
//       });
//     }

//     if (req.body.password.length < 4) {
//       return res.status(400).json({
//         success: false,
//         message: "Password length must be greater than 4!",
//       });
//     }

//     const hashedPassword = await bcrypt.hash(
//       req.body.password,
//       BCRYPT_SALT_ROUNDS
//     );

//     req.body.password = hashedPassword;

//     var newadmin = new AdminModel({
//         username: req.body.username,
//         password: req.body.password
//     });

//     await AdminModel.create(newadmin);
//     console.log("new admin created");

//     return res.status(200).json({
//       success: true,
//       message: "Admin Successfully Signed-up",
//     });

//   } catch (error) {
//     console.log("error (try-catch) : " + error);
//     return res.status(500).json({
//       success: false,
//       err: error,
//     });
//   }
  
// });

/**
 * @swagger
 * /adminlogin:
 *   post:
 *     description: This endpoint is used to login an admin into the system. After login admin can call all the listner endpoints using the token this endpoint provides.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string  
 *           examples:
 *             '1':
 *               value: "{\r\n    \"username\":\"DavidTai123\",\r\n      \"password\":\"David123\"\r\n}"
 *             '2':
 *               value: "{\r\n        \"password\":\"David123\"\r\n}"
 *             '3':
 *               value: "{\r\n    \"username\":\"DavidTai12\",\r\n      \"password\":\"David123\"\r\n}"  
 *             '4':
 *               value: "{\r\n    \"username\":\"DavidTai123\",\r\n      \"password\":\"David\"\r\n}"  
 *     responses:
 *       200:
 *         description: Admin Successfully logged-in
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                               "success": true,
 *                               "errorCode": 0,
 *                               "errorMessage": "",
 *                               "error": null
 *                           },
 *                           "body": {
 *                              "message":"Admin Successfully logged-in"
 *                           }
 *                       }  
 *       400:
 *         description: if any parameter not found in the body
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 400,
 *                             "errorMessage": "Username not found in the request body!",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         }
 *       404:
 *         description: if Admin don't exist against the username
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 404,
 *                             "errorMessage": "Admin don't exist against this username",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         }
 *       403:
 *         description: if password is incorrect
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 403,
 *                             "errorMessage": "Incorrect password entered",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         } 
 */

router.post("/adminlogin", async function (req, res, next) {
  try {

    if (!req.body.username) {
      return res.status(400).json({
        success: false,
        message: "Username not found in the request body!",
      });
    }

    if (!req.body.password) {
      return res.status(400).json({
        success: false,
        message: "Password not found in the request body!",
      });
    }

    var admin = await AdminModel.findOne({
        username: req.body.username,
    });
    console.log("admin : ", admin);

    if (!admin) {
      return res.status(404).json({
        success: true,
        message: "Admin don't exist against this username",
      });
    }

    const validPassword = bcrypt.compareSync(req.body.password, admin.password); // user password is stored as hashed
    if (!validPassword) {
      return res.status(403).json("Incorrect password entered");
    }

    let payload;
    payload = {
      username: req.body.username,
      adminId: admin._id,
    };

    let token = await jwtUtil.sign(payload);

    return res.status(200).json({
      success: true,
      message: "Admin Successfully logged-in",
      token: token,
      AdminId: admin._id,
    });

  } catch (error) {
    console.log("error (try-catch) : " + error);
    return res.status(500).json({
      success: false,
      err: error,
    });
  }
});

module.exports = router;