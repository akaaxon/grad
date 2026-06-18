import express from "express"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import dotenv from "dotenv"
import cors from "cors"
import cookieParser from "cookie-parser"
import { createClient } from "@supabase/supabase-js"
import nodemailer from "nodemailer"
import multer from "multer"
import { verifyAdmin, verifyStudent } from "./middleware.js"
import WebSocket from "ws"
import { GoogleGenerativeAI } from "@google/generative-ai";


dotenv.config()
const app = express()

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
        realtime: {
            transport: WebSocket
        }
    }
);
const upload = multer({ storage: multer.memoryStorage() })

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', 
    port: 587,
    secure: false, 
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.use(cors({
    origin: 'https://edu-liu.netlify.app',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
    credentials: true
}))

app.use(express.json())
app.use(cookieParser())




app.post("/api/chat", async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) return res.status(400).json({ message: "You need to ask a question." });

        // Define the Knowledge Base
        const megaKnowledgeBase = `
      
        ===================================================================
        MODULE 1: GENERAL PORTAL & ACCOUNT RULES (FAQS)
        ===================================================================
        Q: How do I create an account?
        A: Click "Register" on the portal gateway. You must provide your Full Name, and a valid email address.
        
        Q: What should I do if my account gets locked or I see an error?
        A: If you see "Session expired" or authentication errors, clear your browser cookies and cache, or log out and log back in from the front gate. If your email is already in use, contact the IT administration desk immediately.

        Q: Can I change my password or profile details directly from the booking screen?
        A: No, profile and password adjustments must be handled through central IT support. The booking screen is explicitly reserved for submission tracking and scheduling.

        ===================================================================
        MODULE 2: SUBMISSIONS, UPLOADS & REJECTIONS
        ===================================================================
        Q: What happens after I submit a booking request?
        A: Your application is placed into a "pending" status. Admin reviewers evaluate your uploaded credentials. You will receive an automated email notification the second your status shifts to either "approved" or "rejected".

        Q: What are the document upload rules and limits?
        A: Documents must be completely legible, uncorrupted, and uploaded in standard formats (PDF, JPEG, PNG). The system strictly enforces a maximum size limit of 5MB per file. 

        Q: My application was rejected. What do I do?
        A: Check your inbox. The automated rejection email contains a specific "Rejection Reason" written by the reviewing administrator. You must correct the flagged errors or replace missing files and submit a brand-new booking request.

        Q: Can I cancel or edit a booking after submitting?
        A: No, once a booking request is submitted, it is locked in the system for administrative review. If you made a critical mistake, wait for the admin to reject it or contact them directly to clear it out.

        ===================================================================
        MODULE 3: GENERAL OFFICE POLICIES
        ===================================================================
        Q: What are the physical operational hours for appointments?
        A: Administration offices are open Monday through Friday, from 09:00 AM to 04:00 PM. Offices are closed on weekends and official academic holidays.

        Q: What do I need to bring to my scheduled appointment?
        A: You must bring the original hard copies of all documents you uploaded to the portal for verification purposes.

        Q: Can someone else attend my appointment on my behalf?
        A: No, appointments are strictly tied to your authenticated student profile. Third-party representation is not permitted.
        `;

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            systemInstruction: `You are the ultimate automated student support assistant. 
            You must ONLY answer user inquiries using the information extracted from the KNOWLEDGE MATRIX below.
            
            CRITICAL RULES:
            1. If the answer cannot be found explicitly within the matrix, you must reply: "I'm sorry, I am only programmed to answer questions regarding portal services, technical errors, and general administrative guidelines."
            2. Do not use outside knowledge.
            3. Keep answers clear, direct, and authoritative.
            4. If he greets you, greet back politely but concisely. Do not use the greeting as an opportunity to provide additional information.
            
            KNOWLEDGE MATRIX:
            ${megaKnowledgeBase}` 
        });

        // Generate response
        const result = await model.generateContent(question);
        const response = await result.response;
        const text = response.text();

        return res.status(200).json({ reply: text });

    } catch (error) {
        console.error("Gemini Chat Error:", error);
        return res.status(500).json({ 
            message: "The assistant is currently unavailable.", 
            error: error.message 
        });
    }
});

app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required." })
        }

        const { data: admin, error } = await supabase
            .from('admins')
            .select('*')
            .ilike('email', email.trim())
            .single()

        if (error || !admin) {
            return res.status(401).json({ message: "Invalid email or password." })
        }

        const isPasswordValid = await bcrypt.compare(password, admin.password).catch(() => password === admin.password)
        if (!isPasswordValid) {
            return res.status(401).json({ message: "Invalid email or password." })
        }

        const token = jwt.sign(
            { id: admin.id, email: admin.email, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        )

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none',
            maxAge: 24 * 60 * 60 * 1000,
            path: "/"
        })

        return res.status(200).json({
            message: "Login successful.",
            token,
            admin: {
                id: admin.id,
                email: admin.email,
                created_at: admin.created_at,
                role: "admin"
            }
        })
    } catch (error) {
        return res.status(500).json({ message: "An internal server error occurred." })
    }
})

app.get('/api/admin/verify', verifyAdmin, (req, res) => {
    return res.status(200).json({ success: true, admin: req.admin || req.user })
})

app.get("/admin/bookings", verifyAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('bookings')
            .select('*, services(*), students(*)')
            .order('created_at', { ascending: false })

        if (error) throw error

        return res.status(200).json({ message: "Bookings fetched successfully", result: data })
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" })
    }
})

app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'none',
        path: '/'
    })
    return res.status(200).json({ message: "Signed out successfully." })
})

app.post("/admin/approve/:i", verifyAdmin, async (req, res) => {
    try {
        const { i } = req.params

        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('*, students(full_name, email), services(name)')
            .eq('id', i)
            .single()

        if (fetchError || !booking) {
            return res.status(404).json({ message: "Booking ID doesn't exist" })
        }

        if (booking.status === "approved" || booking.status === "rejected") {
            return res.status(400).json({ message: "Booking was already approved or rejected" })
        }

        const { error: updateError } = await supabase
            .from('bookings')
            .update({ status: 'approved' })
            .eq('id', i)

        if (updateError) throw updateError

        const mailOptions = {
            from: `"Ministry of Education Services" <${process.env.EMAIL_USER}>`,
            to: booking.students.email,
            subject: `Update on your ${booking.services.name} Application`,
            html: `
                <div style="font-family: Arial, sans-serif; color: #333;">
                    <h2 style="color: #27ae60;">Application Approved!</h2>
                    <p>Dear ${booking.students.full_name},</p>
                    <p>Great news! Your application for <strong>${booking.services.name}</strong> has been officially approved.</p>
                    <p><strong>Appointment Time:</strong> ${new Date(booking.appointment_time).toLocaleString()}</p>
                    <p>Please make sure to arrive on time.</p>
                    <br/>
                    <p>Best regards,<br/>The Administration Team</p> 
                </div>
            `
        }

        transporter.sendMail(mailOptions)
  .then((info) => console.log("Email sent:", info.response))
  .catch((err) => console.error("Email failed:", err));

        return res.status(200).json({ message: "Booking was approved successfully" })
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" })
    }
})

app.post("/admin/reject/:i", verifyAdmin, async (req, res) => {
    try {
        const { i } = req.params
        const { reason } = req.body

        if (!reason || reason.trim() === "") {
            return res.status(400).json({ message: "A rejection reason is required" })
        }

        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('*, students(full_name, email), services(name)')
            .eq('id', i)
            .single()

        if (fetchError || !booking) {
            return res.status(404).json({ message: "Booking ID doesn't exist" })
        }

        if (booking.status === "approved" || booking.status === "rejected") {
            return res.status(400).json({ message: "Booking is already processed" })
        }

        const { error: updateError } = await supabase
            .from('bookings')
            .update({ status: 'rejected', rejection_reason: reason.trim() })
            .eq('id', i)

        if (updateError) throw updateError

        const mailOptions = {
            from: `"Ministry of Education Services" <${process.env.EMAIL_USER}>`,
            to: booking.students.email,
            subject: `Update on your ${booking.services.name} Application`,
            html: `
                <div style="font-family: Arial, sans-serif; color: #333;">
                    <h2 style="color: #e74c3c;">Application Update</h2>
                    <p>Dear ${booking.students.full_name},</p>
                    <p>We have reviewed your application for <strong>${booking.services.name}</strong>. Unfortunately, it has been rejected at this time.</p>
                    <p><strong>Reason:</strong> ${reason.trim()}</p>
                    <p>You may submit a new application once the requested corrections are made.</p>
                    <br/>
                    <p>Best regards,<br/>The Administration Team</p>
                </div>
            `
        }

        transporter.sendMail(mailOptions).catch(() => { })

        return res.status(200).json({ message: "Booking was rejected successfully" })
    } catch (error) {
        conso
        return res.status(500).json({ message: "Internal server error" })
    }
})

app.post("/admin/service", verifyAdmin, async (req, res) => {
    try {
        const { name, description, required_documents, available_times } = req.body

        if (!name || typeof name !== 'string' || name.trim() === "") {
            return res.status(400).json({ message: "Service name is required." })
        }
        if (!description || typeof description !== 'string' || description.trim() === "") {
            return res.status(400).json({ message: "Description required." })
        }
        if (!required_documents || !Array.isArray(required_documents)) {
            return res.status(400).json({ message: "You must specify at least one required document." })
        }

        const cleanedDocs = required_documents
            .map(doc => (typeof doc === 'string' ? doc.trim() : ""))
            .filter(doc => doc !== "")

        if (cleanedDocs.length === 0) {
            return res.status(400).json({
                message: "Application creation denied. You must provide the name of at least one required document."
            })
        }
        const cleanedTimes = available_times
            .map(time => (typeof time === 'string' ? time.trim() : ""))
            .filter(time => time !== "");
        const { data, error } = await supabase
            .from('services')
            .insert([{ 
                name: name.trim(), 
                description: description.trim(), 
                required_documents: cleanedDocs,
                available_times: cleanedTimes 
            }])
            .select()
            .single()

        if (error) throw error

        return res.status(201).json({
            message: "Service created successfully.",
            service: data
        })
    } catch (error) {
        console.error("Service creation error:", error);
        return res.status(500).json({ message: "Internal server error." })
    }
})

app.delete("/admin/service/:id", verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params

        const { data, error } = await supabase
            .from('services')
            .delete()
            .eq('id', id)
            .select()
            .single()

        if (error || !data) {
            return res.status(404).json({ message: "Service not found or already deleted." })
        }

        return res.status(200).json({
            message: "Service deleted successfully.",
            deletedService: data
        })
    } catch (error) {
        return res.status(500).json({ message: "Internal server error." })
    }
})

app.get("/admin/service", verifyAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('services')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) throw error

        return res.status(200).json({ message: "Services fetched successfully", result: data })
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" })
    }
})



app.get('/api/student/verify', verifyStudent, (req, res) => {
    return res.status(200).json({ success: true, student: req.student });
});


app.post("/api/student/register", async (req, res) => {
    try {
        const { full_name, email, password } = req.body

        if (!full_name || !email || !password) {
            return res.status(400).json({ message: "All fields are required." })
        }

        const { data: existingStudent } = await supabase
            .from('students')
            .select('id')
            .or(`email.eq.${email.toLowerCase().trim()}`)

        if (existingStudent && existingStudent.length > 0) {
            return res.status(400).json({ message: "Email already in use." })
        }

        const hashedPassword = await bcrypt.hash(password, 10)

        const { data: newStudent, error } = await supabase
            .from('students')
            .insert([{
                full_name: full_name.trim(),
                email: email.toLowerCase().trim(),
                password: hashedPassword
            }])
            .select('id, full_name, email')
            .single()

        if (error) throw error

        return res.status(201).json({ message: "Registration successful.", student: newStudent })
    } catch (error) {
        return res.status(500).json({ message: "Internal server error." })
    }
})

app.post("/api/student/login", async (req, res) => {
    try {
        const { email, password } = req.body

        const { data: student, error } = await supabase
            .from('students')
            .select('*')
            .ilike('email', email.trim())
            .single()

        if (error || !student) {
            return res.status(401).json({ message: "Invalid credentials." })
        }

        const isValid = await bcrypt.compare(password, student.password)
        if (!isValid) {
            return res.status(401).json({ message: "Invalid credentials." })
        }

        const token = jwt.sign({ id: student.id, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '1d' })

        res.cookie('studentToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        })

        return res.status(200).json({ message: "Logged in successfully.", student: { id: student.id, full_name: student.full_name } })
    } catch (error) {
        return res.status(500).json({ message: "Internal server error." })
    }
})

app.post("/api/student/logout", (req, res) => {
    res.clearCookie('studentToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'none',
        path: '/'
    })
    return res.status(200).json({ message: "Signed out successfully." })
})

app.get("/api/services", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('services')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) throw error

        return res.status(200).json({ result: data })
    } catch (error) {
        return res.status(500).json({ message: "Error fetching services." })
    }
})

app.post("/api/student/upload", verifyStudent, upload.single("document"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file provided." })
        }

        const fileExtension = req.file.originalname.split('.').pop()
        const uniqueFileName = `${req.student.id}-${Date.now()}.${fileExtension}`

        const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(uniqueFileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            })

        if (uploadError) throw uploadError

        const { data: publicUrlData } = supabase.storage
            .from('documents')
            .getPublicUrl(uniqueFileName)

        return res.status(200).json({
            message: "File uploaded successfully",
            url: publicUrlData.publicUrl
        })
    } catch (error) {
        console.error("File upload error:", error);
        return res.status(500).json({ message: "Internal server error during file upload." })
    }
})

app.post("/api/student/bookings", verifyStudent, async (req, res) => {
    try {
        const studentId = req.student.id
        const { service_id, appointment_time, document_urls } = req.body

        if (!service_id || !appointment_time || !document_urls || !Array.isArray(document_urls)) {
            return res.status(400).json({ message: "Missing required booking details." })
        }

        const { data, error } = await supabase
            .from('bookings')
            .insert([{
                student_id: studentId,
                service_id,
                appointment_time,
                document_urls,
                status: 'pending'
            }])
            .select()
            .single()

        if (error) throw error

        return res.status(201).json({ message: "Application submitted successfully.", booking: data })
    } catch (error) {
        console.error("Error:", error);
        return res.status(500).json({ message: "Internal server error." })
    }
})

app.listen(3000, () => {
    console.log("server running on port 3000")
})
