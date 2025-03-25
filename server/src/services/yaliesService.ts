import axios from "axios";
import dotenv from "dotenv";
import { createUser, validateUser } from "./userService";

dotenv.config();

const YALIES_API_URL = "https://api.yalies.io/v2/people";
const API_KEY = process.env.YALIES_API_KEY;

/**
  * Function to fetch a Yalie by NetID.
  * - First, check the database for cached data.
  * - If not found, fetch from Yalies API, validate required fields, store it in the database, and return it.
*/
export const fetchYalie = async (netid: any) => {
    try {  
      // Fetch user from Yalies API
      let yaliesResponse;

      try {
        console.log('Yalies: making post request')
        yaliesResponse = await axios.post(
            YALIES_API_URL,
            { filters: { netid: [netid] } },
            { headers: { Authorization: `Bearer ${API_KEY}` } }
        );   
      } catch (error) {
        console.error("Error fetching from Yalies API:", error.message);
        return null;
      }
      console.log('Yalies: done making post request');
      const yaliesData = yaliesResponse.data;
  
      if (!yaliesData || yaliesData.length === 0) {
        console.log(`No Yalie found for netid: ${netid}`);  
        return null;
      }
  
      const yalie = yaliesData[0];
  
      // Validate required fields before saving
      if (!yalie.first_name || !yalie.last_name || !yalie.email || !yalie.year || !yalie.school_code) {
        console.log(`Missing required fields from Yalies API response for netid: ${netid}`);
        return null;
      }

      let userType;

      if(yalie.school_code === "YC") {
        userType = "undergraduate";
      } else {
        userType = "graduate";
      }
  
      // Create formatted user object
      const userData = {
        netid: yalie.netid,
        fname: yalie.first_name || "",
        lname: yalie.last_name || "",
        email: yalie.email,
        college: yalie.college || "",
        year: yalie.year,
        userType: userType,
        userConfirmed: true,
        major: (yalie.major && Array.isArray(yalie.major) ? yalie.major : [yalie.major]) || [], // Ensure it's an array
      };
  
      console.log('Yalies: saving user to mongoDB');

      // Check if the user already exists in MongoDB
      console.log('Yalies: validating user');
      let user = await validateUser(netid);
      if (user) {
        return user;
      }
      console.log('Yalies: done validating user');

      // Save user to MongoDB
      user = await createUser(userData);
      console.log('Yalies: user saved, returning user');
  
      return user;
    } catch (error) {
      console.error("Error fetching user:", error.message);
      return null;
    }
  };