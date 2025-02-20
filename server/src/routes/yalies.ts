import { Router, Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import { User } from "../models/User";

dotenv.config();

const router = Router();
const YALIES_API_URL = "https://api.yalies.io/v2/";
const API_KEY = process.env.YALIES_API_KEY;

/**
 * Route to fetch a Yalie by NetID.
 * - First, check the database for cached data.
 * - If not found, fetch from Yalies API, validate required fields, store it in the database, and return it.
 */
router.get("/byNetId/:netid", async (request: Request, response: Response) => {
  try {
    const { netid } = request.params;

    // Check if the user already exists in MongoDB
    let user = await User.findById(netid);
    if (user) {
      response.status(200).json(user);
    }

    // Fetch user from Yalies API
    const yaliesResponse = await axios.post(
      YALIES_API_URL,
      { filters: { netid: [netid] } },
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );

    const yaliesData = yaliesResponse.data;

    if (!yaliesData || yaliesData.length === 0) {
        response.status(404).json({ message: "User not found" });
    }

    const yalie = yaliesData[0];

    // Validate required fields before saving
    if (!yalie.email || !yalie.year || !yalie.major) {
      response.status(400).json({ message: "Missing required fields from Yalies API response." });
    }

    // Create formatted user object
    user = new User({
      _id: yalie.netid, // Using netid as the primary key (_id)
      netid: yalie.netid,
      firstName: yalie.first_name || "",
      lastName: yalie.last_name || "",
      email: yalie.email,
      college: yalie.college || "",
      year: yalie.year,
      major: Array.isArray(yalie.major) ? yalie.major : [yalie.major], // Ensure it's an array
      phone: yalie.phone || "",
    });

    // Save user to MongoDB
    await user.save();

    response.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user:", error.message);
    response.status(500).send({ message: "Internal Server Error" });
  }
});

/**
 * Route to fetch Yalies based on optional queries: firstName, lastName, college, and year.
 * - Uses MongoDB first if available.
 * - Otherwise, queries Yalies API, validates required fields, stores them in the database, and returns them.
 */
router.get("/", async (request: Request, response: Response) => {
  try {
    const firstName = request.query.firstName ? String(request.query.firstName) : "";
    const lastName = request.query.lastName ? String(request.query.lastName) : "";
    const college = request.query.college ? String(request.query.college) : "";
    const year = request.query.year ? String(request.query.year) : "";

    if (!firstName && !lastName && !college && !year) {
      response.status(400).json({ message: "At least one query parameter must be provided" });
    }

    let filters: Record<string, string | string[]> = {};
    if (firstName) filters["first_name"] = firstName;
    if (lastName) filters["last_name"] = lastName;
    if (college) filters["college"] = college;
    if (year) filters["year"] = year;

    // First, check if users are already cached in the database
    const cachedUsers = await User.find({
      ...(firstName && { firstName: { $regex: firstName, $options: "i" } }),
      ...(lastName && { lastName: { $regex: lastName, $options: "i" } }),
      ...(college && { college }),
      ...(year && { year }),
    });

    if (cachedUsers.length > 0) {
        response.status(200).json(cachedUsers);
    }

    // Fetch from Yalies API if not found in MongoDB
    const yaliesResponse = await axios.post(
      YALIES_API_URL,
      { filters },
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );

    const yaliesData = yaliesResponse.data;

    if (!yaliesData || yaliesData.length === 0) {
      response.status(404).json({ message: "No users found" });
    }

    // Format and store users in MongoDB
    const formattedUsers = yaliesData
      .filter((yalie: any) => yalie.email && yalie.year && yalie.major)
      .map((yalie: any) => ({
        _id: yalie.netid,
        netid: yalie.netid,
        firstName: yalie.first_name || "",
        lastName: yalie.last_name || "",
        email: yalie.email,
        college: yalie.college || "",
        year: yalie.year,
        major: Array.isArray(yalie.major) ? yalie.major : [yalie.major],
        phone: yalie.phone || "",
      }));

    // Bulk insert users into MongoDB
    await User.insertMany(formattedUsers, { ordered: false }).catch((err) => {
      console.error("Error inserting users into MongoDB:", err.message);
    });

    response.status(200).json(formattedUsers);
  } catch (error) {
    console.error("Error fetching users:", error.message);
    response.status(500).send({ message: "Internal Server Error" });
  }
});

export default router;