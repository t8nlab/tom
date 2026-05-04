import { defineAction } from "@titanpl/native";
import { google } from "./auth_test";


export default defineAction((req) => {
    return google.signIn()
})