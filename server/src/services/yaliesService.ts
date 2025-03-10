import axios from "axios";
import dotenv from "dotenv";
import { User } from "../models/User";
import { createUser, validateUser } from "./userService";

dotenv.config();

const YALIES_API_URL = "https://api.yalies.io/v2/people";
const API_KEY = process.env.YALIES_API_KEY;

/**
  * Function to fetch a Yalie by NetID.
  * - First, check the database for cached data.
  * - If not found, fetch from Yalies API, validate required fields, store it in the database, and return it.
*/
export const fetchYalie = async (netid: String) => {
    try {
      // Check if the user already exists in MongoDB
      let user = await validateUser(netid);
      if (user) {
        return user;
      }
  
      // Fetch user from Yalies API
      let yaliesResponse;

      try {
        yaliesResponse = await axios.post(
            YALIES_API_URL,
            { filters: { netid: [netid] } },
            { headers: { Authorization: `Bearer ${API_KEY}` } }
        );
      } catch (error) {
        console.error("Error fetching from Yalies API:", error.message);
        return null;
      }
      const yaliesData = yaliesResponse.data;
  
      if (!yaliesData || yaliesData.length === 0) {
        console.log(`No Yalie found for netid: ${netid}`);  
        return null;
      }
  
      const yalie = yaliesData[0];
  
      // Validate required fields before saving
      if (!yalie.first_name || !yalie.last_name || !yalie.email || !yalie.year || !yalie.major) {
        console.log(`Missing required fields from Yalies API response for netid: ${netid}`);
        return null;
      }
  
      // Create formatted user object
      const userData = {
        netid: yalie.netid,
        fname: yalie.first_name || "",
        lname: yalie.last_name || "",
        email: yalie.email,
        college: yalie.college || "",
        year: yalie.year,
        major: Array.isArray(yalie.major) ? yalie.major : [yalie.major], // Ensure it's an array
      };
  
      // Save user to MongoDB
      user = await createUser(userData);
  
      return user;
    } catch (error) {
      console.error("Error fetching user:", error.message);
      return null;
    }
  };