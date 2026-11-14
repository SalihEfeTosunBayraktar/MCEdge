// Made with Blockbench 3.9.2
// Exported for Minecraft version 1.15 - 1.16 with MCP mappings
// Paste this class into your mod and generate all required imports

public class ruby_imp extends EntityModel<Entity> {
	private final ModelRenderer bb_main;
	private final ModelRenderer wing;
	private final ModelRenderer cube_r1;

	public ruby_imp() {
		textureWidth = 32;
		textureHeight = 32;

		bb_main = new ModelRenderer(this);
		bb_main.setRotationPoint(0.0F, 24.0F, 0.0F);
		bb_main.setTextureOffset(0, 0).addBox(-2.0F, -14.0F, -2.0F, 4.0F, 4.0F, 4.0F, 0.0F, false);

		wing = new ModelRenderer(this);
		wing.setRotationPoint(2.0F, -12.0F, 0.0F);
		bb_main.addChild(wing);

		cube_r1 = new ModelRenderer(this);
		cube_r1.setRotationPoint(0.0F, 0.0F, 0.0F);
		wing.addChild(cube_r1);
		setRotationAngle(cube_r1, 0.0F, 0.0F, -0.3927F);
		cube_r1.setTextureOffset(0, 8).addBox(0.0F, -1.0F, -2.0F, 5.0F, 1.0F, 4.0F, 0.0F, true);
	}

	@Override
	public void setRotationAngles(Entity entity, float limbSwing, float limbSwingAmount, float ageInTicks, float netHeadYaw, float headPitch){
	}

	@Override
	public void render(MatrixStack matrixStack, IVertexBuilder buffer, int packedLight, int packedOverlay, float red, float green, float blue, float alpha){
		bb_main.render(matrixStack, buffer, packedLight, packedOverlay);
	}

	public void setRotationAngle(ModelRenderer modelRenderer, float x, float y, float z) {
		modelRenderer.rotateAngleX = x;
		modelRenderer.rotateAngleY = y;
		modelRenderer.rotateAngleZ = z;
	}
}
