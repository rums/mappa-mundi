import { auth } from "../auth/middleware";
export const handler = () => auth();
