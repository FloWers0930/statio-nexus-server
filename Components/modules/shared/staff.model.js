// backend/src/modules/shared/staff.model.js
// Staff model for station owners to manage attendants/supervisors

const mongoose = require("mongoose");

const DOCUMENT_CATEGORIES = [
  "ID Proof",
  "Resume / CV",
  "Contract / Agreement",
  "Medical Certificate",
  "Training Certificate",
  "Other",
];

const documentSubSchema = new mongoose.Schema({
  id: { type: String, required: [true, "Document ID is required"], trim: true },
  name: {
    type: String,
    required: [true, "Document name is required"],
    trim: true,
    minlength: [3, "Document name must be at least 3 characters"],
    maxlength: [200, "Document name cannot exceed 200 characters"],
  },
  category: {
    type: String,
    enum: { values: DOCUMENT_CATEGORIES, message: "Invalid document category" },
    required: [true, "Document category is required"],
    default: "Other",
  },
  url: { type: String, trim: true },
  base64: {
    type: String,
    validate: {
      validator: function (v) {
        if (!v) return true;
        return /^data:(image\/(jpeg|png)|application\/pdf);base64,/.test(v);
      },
      message:
        "Invalid base64 format. Must be image/jpeg, image/png or application/pdf",
    },
  },
  uploadedAt: { type: Date, default: Date.now },
});

const staffSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owner is required"],
    },
    name: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username cannot exceed 30 characters"],
      match: [
        /^[a-zA-Z0-9_]+$/,
        "Username can only contain letters, numbers and underscores",
      ],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      match: [/^\+?[\d\s-]{8,20}$/, "Please provide a valid phone number"],
    },
    dateOfBirth: {
      type: Date,
      required: [true, "Date of birth is required"],
      validate: {
        validator: function (value) {
          const age = new Date().getFullYear() - value.getFullYear();
          return age >= 18 && age <= 100;
        },
        message: "Staff must be between 18 and 100 years old",
      },
    },
    gender: {
      type: String,
      enum: {
        values: ["Male", "Female", "Other"],
        message: "Gender must be Male, Female or Other",
      },
      required: [true, "Gender is required"],
    },
    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
      minlength: [5, "Address must be at least 5 characters"],
      maxlength: [255, "Address cannot exceed 255 characters"],
    },
    idNumber: {
      type: String,
      required: [true, "ID Number is required"],
      trim: true,
      minlength: [5, "ID Number must be at least 5 characters"],
      maxlength: [30, "ID Number cannot exceed 30 characters"],
    },
    emergencyContactName: {
      type: String,
      required: [true, "Emergency contact name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    emergencyContactPhone: {
      type: String,
      required: [true, "Emergency contact phone is required"],
      trim: true,
      match: [/^\+?[\d\s-]{8,20}$/, "Please provide a valid phone number"],
    },
    role: {
      type: String,
      enum: {
        values: ["attendant", "supervisor", "manager", "admin"],
        message: "Role must be attendant, supervisor, manager or admin",
      },
      default: "attendant",
    },
    permissions: {
      type: [String],
      default: function () {
        if (this.role === "manager")
          return [
            "view_spots",
            "manage_spots",
            "view_bookings",
            "manage_bookings",
            "view_reports",
          ];
        if (this.role === "supervisor")
          return [
            "view_spots",
            "manage_spots",
            "view_bookings",
            "view_reports",
          ];
        return ["view_spots", "view_bookings"];
      },
      enum: [
        "view_spots",
        "manage_spots",
        "view_bookings",
        "manage_bookings",
        "view_reports",
        "manage_reports",
        "manage_staff",
      ],
    },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    passwordHash: String,
    salt: String,
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    documents: {
      type: [documentSubSchema],
      validate: {
        validator: function (docs) {
          if (!docs) return true;
          if (docs.length > 10) return false;
          const ids = docs.map((d) => d.id);
          return new Set(ids).size === ids.length;
        },
        message:
          "Maximum 10 documents allowed and all document IDs must be unique",
      },
    },
  },
  { timestamps: true },
);

// Soft delete middleware
staffSchema.pre(/^find/, function (next) {
  this.where({ deletedAt: null });
  next();
});

const Staff = mongoose.model("Staff", staffSchema);

module.exports = Staff;
