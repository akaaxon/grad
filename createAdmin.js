import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import WebSocket from "ws";

dotenv.config();

const supabase = createClient(
       process.env.SUPABASE_URL, 
       process.env.SUPABASE_SERVICE_KEY,
       {
           realtime: {
               transport: WebSocket
           }
       }
   );

async function createAdmin() {
    const email = process.argv[2];
    const plainTextPassword = process.argv[3];

    if (!email || !plainTextPassword) {
        console.error(" Usage: node create_admin.js <email> <password>");
        process.exit(1);
    }

    console.log(`Hashing password for ${email}...`);
    
    try {
        const hashedPassword = await bcrypt.hash(plainTextPassword, 10);

        const { data, error } = await supabase
            .from('admins')
            .insert([{ 
                email: email.toLowerCase().trim(), 
                password: hashedPassword 
            }])
            .select('id, email')
            .single();

        if (error) {
            if (error.code === '23505') {
                console.error(" Error: An admin with that email already exists.");
            } else {
                console.error(" Database Error:", error.message);
            }
            process.exit(1);
        }

        console.log("Admin successfully created!");
        console.log(`ID: ${data.id}`);
        console.log(`Email: ${data.email}`);
        process.exit(0);

    } catch (err) {
        console.error(" Execution Error:", err);
        process.exit(1);
    }
}

createAdmin();