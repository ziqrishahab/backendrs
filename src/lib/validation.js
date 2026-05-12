const Joi = require('joi');

const phonePattern = /^(\+62|62|0)8[1-9][0-9]{6,11}$/;
const namePattern = /^[a-zA-Z\s'-]{2,50}$/;

const schemas = {
  userRegister: Joi.object({
    name: Joi.string().min(2).max(50).pattern(namePattern).required().messages({ 'string.pattern.base': 'Nama hanya boleh huruf', 'string.min': 'Nama minimal 2 karakter' }),
    email: Joi.string().email().max(255).required().messages({ 'string.email': 'Format email tidak valid' }),
    password: Joi.string().min(8).max(100).required().messages({ 'string.min': 'Password minimal 8 karakter' }),
    phone: Joi.string().pattern(phonePattern).allow(null,'').optional().messages({ 'string.pattern.base': 'Format nomor telepon tidak valid' }),
  }),
  userLogin: Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(1).required() }),
  forgotPassword: Joi.object({ email: Joi.string().email().required() }),
  resetPassword: Joi.object({ token: Joi.string().uuid().required(), new_password: Joi.string().min(8).max(100).required() }),
  updateProfile: Joi.object({ name: Joi.string().min(2).max(50).pattern(namePattern).optional(), phone: Joi.string().pattern(phonePattern).allow(null,'').optional(), address: Joi.string().min(5).max(500).optional() }).min(1),
  changePassword: Joi.object({ current_password: Joi.string().required(), new_password: Joi.string().min(8).max(100).required() }),
  bookingCreate: Joi.object({ schedule_id: Joi.string().uuid().required(), patient_name: Joi.string().min(2).max(100).required(), patient_phone: Joi.string().pattern(phonePattern).allow(null,'').optional(), notes: Joi.string().max(500).allow(null,'').optional() }),
  chat: Joi.object({ message: Joi.string().min(1).max(4000).required(), session_id: Joi.string().uuid().allow(null,'').optional(), device_id: Joi.string().min(1).max(200).optional() }),
};

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: true, message: 'Validasi gagal', details: error.details.map(d=>d.message) });
  req.body = value;
  next();
};

module.exports = { schemas, validate };
