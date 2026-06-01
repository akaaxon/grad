import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-key";


export const verifyAdmin = (req, res, next) => {

    const token = req.cookies.token; 

    if (!token) {
        return res.status(401).json({ message: "No token provided." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET); 
        
        if (decoded.role !== 'admin') {
             return res.status(403).json({ message: "Not an admin." });
        }
        
        req.admin = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ message: "Invalid token." });
    }
}


export const verifyStudent = (req, res, next) => {

    const token = req.cookies.studentToken; 
    
    if (!token) {
        console.log("❌ Blocked: No studentToken found.");
        return res.status(401).json({ message: "Please log in to continue." });
    }

    try {
  
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.role !== 'student') {
            return res.status(403).json({ message: "Access denied." });
        }
        
        req.student = decoded; 
        next();
    } catch (error) {
        return res.status(403).json({ message: "Session expired." });
    }
};