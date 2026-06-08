import json
from pathlib import Path
p=Path('/mnt/data/prog/exercise_database.json')
db=json.loads(p.read_text())
mg=db.setdefault('muscleGroups',{})
mg.update({
 'latissimus_dorsi':{'name':'광배근','color':'#45B7D1'}, 'rhomboids':{'name':'능형근','color':'#4aa3df'},
 'rear_deltoid':{'name':'후면 삼각근','color':'#96CEB4'}, 'anterior_deltoid':{'name':'전면 삼각근','color':'#96CEB4'},
 'deltoids':{'name':'삼각근','color':'#96CEB4'}, 'upper_trapezius':{'name':'상부 승모근','color':'#88d8b0'},
 'lower_back':{'name':'척추기립근','color':'#45B7D1'}, 'traps':{'name':'승모근','color':'#88d8b0'},
 'full_body':{'name':'전신','color':'#00f5ff'}, 'hip_flexors':{'name':'고관절 굴곡근','color':'#FFA07A'},
 'adductors':{'name':'내전근','color':'#FF8E53'}, 'abductors':{'name':'외전근','color':'#FF8E53'},
})
def ex(id,name,cat,muscles,key,rep,purpose,benefits,instructions,precautions):
    db['exercises'][id]={
      'id':id,'name':name,'category':cat,'muscleGroups':muscles,
      'purpose':purpose,'benefits':benefits,'instructions':instructions,'precautions':precautions,
      'keyAngles':key,'repDetection':rep,'commonErrors':[{'id':'form_check','message':'관절 정렬과 호흡을 유지하세요.'}]
    }
base_key_upper={'elbow':{'min':45,'max':175,'optimal':100},'shoulder':{'min':30,'max':180,'optimal':90},'spine':{'min':160,'max':185,'optimal':175}}
base_key_lower={'knee':{'min':60,'max':175,'optimal':100},'hip':{'min':50,'max':180,'optimal':110},'spine':{'min':155,'max':185,'optimal':175}}
add=[
('bodyweight_lunge','런지','bodyweight',['quadriceps','glutes','hamstrings','core'],base_key_lower,{'primaryJoint':'knee','bottomThreshold':95,'topThreshold':160,'direction':'down_up'},'하체 근력과 균형 향상','허벅지·엉덩이 강화, 좌우 균형 개선',['한 발을 앞으로 내딛고 상체를 세웁니다.','앞무릎이 발끝 방향으로 향하게 내려갑니다.','앞발 뒤꿈치로 밀어 시작 자세로 돌아옵니다.'],['무릎이 안쪽으로 무너지지 않게 하세요.','허리가 꺾이지 않게 복부에 힘을 주세요.']),
('glute_bridge','글루트 브릿지','bodyweight',['glutes','hamstrings','core'],{'hip':{'min':90,'max':180,'optimal':175},'spine':{'min':160,'max':185,'optimal':175}}, {'primaryJoint':'hip','bottomThreshold':110,'topThreshold':165,'direction':'up_down'},'둔근 활성화','엉덩이 힘과 골반 안정성 향상',['누워서 무릎을 세우고 발을 골반 너비로 둡니다.','엉덩이를 조이며 골반을 들어 올립니다.','허리가 아닌 엉덩이 힘으로 천천히 내립니다.'],['허리를 과하게 꺾지 마세요.']),
('mountain_climber','마운틴 클라이머','cardio',['core','hip_flexors','shoulders'],{'hip':{'min':45,'max':180,'optimal':120},'knee':{'min':45,'max':175,'optimal':90},'spine':{'min':160,'max':185,'optimal':175}}, {'primaryJoint':'hip','bottomThreshold':80,'topThreshold':150,'direction':'full_cycle'},'심박수 상승과 코어 강화','유산소 능력과 복부 안정성 향상',['푸시업 자세를 만듭니다.','한쪽 무릎을 가슴 쪽으로 당깁니다.','좌우 다리를 리듬 있게 교차합니다.'],['엉덩이가 들리거나 처지지 않게 하세요.']),
('jumping_jack','점핑잭','cardio',['full_body','calves','shoulders'],{'shoulder':{'min':20,'max':180,'optimal':160},'hip':{'min':140,'max':180,'optimal':170}}, {'primaryJoint':'shoulder','bottomThreshold':40,'topThreshold':150,'direction':'down_up'},'전신 워밍업과 심폐 향상','체온 상승, 전신 순환 개선',['발을 모으고 섭니다.','점프하며 팔과 다리를 벌립니다.','다시 점프해 시작 자세로 돌아옵니다.'],['무릎과 발목 충격을 줄이기 위해 부드럽게 착지하세요.']),
('high_knees','하이 니','cardio',['hip_flexors','quadriceps','core','calves'],{'hip':{'min':60,'max':180,'optimal':90},'knee':{'min':60,'max':175,'optimal':90}}, {'primaryJoint':'hip','bottomThreshold':85,'topThreshold':155,'direction':'full_cycle'},'심폐 지구력 향상','심박수 증가, 고관절 움직임 개선',['상체를 세우고 제자리에서 뜁니다.','무릎을 골반 높이까지 들어 올립니다.','팔을 자연스럽게 흔듭니다.'],['허리가 뒤로 젖혀지지 않게 복부에 힘을 주세요.']),
('dumbbell_curl','덤벨 컬','dumbbell',['biceps'],{'elbow':{'min':45,'max':170,'optimal':60},'shoulder':{'min':0,'max':45,'optimal':20}}, {'primaryJoint':'elbow','bottomThreshold':155,'topThreshold':60,'direction':'up_down'},'이두근 강화','팔 앞쪽 근력과 근지구력 향상',['팔꿈치를 몸 옆에 고정합니다.','덤벨을 어깨 방향으로 들어 올립니다.','천천히 내려 팔을 거의 폅니다.'],['몸을 반동으로 흔들지 마세요.']),
('dumbbell_lateral_raise','덤벨 레터럴 레이즈','dumbbell',['deltoids'],{'shoulder':{'min':20,'max':110,'optimal':90},'elbow':{'min':130,'max':175,'optimal':160}}, {'primaryJoint':'shoulder','bottomThreshold':30,'topThreshold':90,'direction':'down_up'},'어깨 측면 강화','어깨 라인과 견관절 안정성 향상',['덤벨을 몸 옆에 둡니다.','팔꿈치를 살짝 굽힌 채 어깨 높이까지 올립니다.','천천히 시작 자세로 내립니다.'],['승모근으로 으쓱하지 마세요.']),
('dumbbell_shoulder_press','덤벨 숄더 프레스','dumbbell',['deltoids','triceps'],base_key_upper, {'primaryJoint':'elbow','bottomThreshold':80,'topThreshold':160,'direction':'down_up'},'어깨와 삼두근 강화','상체 밀기 근력 향상',['덤벨을 어깨 옆에 둡니다.','팔을 위로 밀어 올립니다.','팔꿈치를 조절하며 천천히 내립니다.'],['허리를 과신전하지 마세요.']),
('goblet_squat','고블릿 스쿼트','dumbbell',['quadriceps','glutes','core'],base_key_lower, {'primaryJoint':'knee','bottomThreshold':95,'topThreshold':155,'direction':'down_up'},'초보자용 스쿼트 패턴 학습','하체 강화와 코어 안정성 향상',['덤벨을 가슴 앞에 잡습니다.','가슴을 세우고 앉듯이 내려갑니다.','발바닥 전체로 밀어 올라옵니다.'],['무릎이 안쪽으로 모이지 않게 하세요.']),
('barbell_row','바벨 로우','barbell',['latissimus_dorsi','rhomboids','biceps'],{'elbow':{'min':45,'max':170,'optimal':60},'hip':{'min':60,'max':130,'optimal':90},'spine':{'min':155,'max':180,'optimal':170}}, {'primaryJoint':'elbow','bottomThreshold':155,'topThreshold':65,'direction':'up_down'},'등 근육 강화','등 두께와 견갑 조절 능력 향상',['힙힌지로 상체를 숙입니다.','바벨을 배꼽 쪽으로 당깁니다.','등을 유지하며 천천히 내립니다.'],['허리가 말리지 않게 하세요.']),
('barbell_biceps_curl','바벨 컬','barbell',['biceps'],{'elbow':{'min':45,'max':170,'optimal':60},'shoulder':{'min':0,'max':45,'optimal':20}}, {'primaryJoint':'elbow','bottomThreshold':155,'topThreshold':60,'direction':'up_down'},'이두근 강화','팔 근력과 그립 안정성 향상',['바벨을 어깨너비로 잡습니다.','팔꿈치를 고정하고 들어 올립니다.','천천히 내려 긴장을 유지합니다.'],['허리 반동을 쓰지 마세요.']),
('leg_press','레그프레스','machine',['quadriceps','glutes','hamstrings'],base_key_lower, {'primaryJoint':'knee','bottomThreshold':90,'topThreshold':160,'direction':'down_up'},'하체 근력 향상','스쿼트보다 안정적으로 대퇴사두근 강화',['발을 발판에 골반 너비로 둡니다.','무릎을 굽혀 천천히 내립니다.','무릎을 완전히 잠그지 않고 밀어냅니다.'],['무릎 과신전을 피하세요.']),
('lat_pulldown','랫풀다운','machine',['latissimus_dorsi','biceps','rear_deltoid'],base_key_upper, {'primaryJoint':'elbow','bottomThreshold':155,'topThreshold':65,'direction':'up_down'},'광배근 강화','등 너비와 당기는 힘 향상',['바를 어깨보다 넓게 잡습니다.','가슴을 세우고 쇄골 쪽으로 당깁니다.','견갑을 조절하며 천천히 올립니다.'],['목 뒤로 당기지 마세요.']),
('seated_row','시티드 로우','machine',['latissimus_dorsi','rhomboids','biceps'],base_key_upper, {'primaryJoint':'elbow','bottomThreshold':155,'topThreshold':65,'direction':'up_down'},'등 중앙부 강화','견갑 후인과 자세 개선',['가슴을 세우고 손잡이를 잡습니다.','팔꿈치를 뒤로 보내며 당깁니다.','등 긴장을 유지하며 천천히 폅니다.'],['상체를 과하게 젖히지 마세요.']),
('chest_press_machine','체스트 프레스 머신','machine',['chest','triceps','anterior_deltoid'],base_key_upper, {'primaryJoint':'elbow','bottomThreshold':80,'topThreshold':155,'direction':'down_up'},'가슴 밀기 근력 향상','초보자도 안정적으로 가슴 자극',['손잡이를 가슴 옆에 맞춥니다.','팔을 앞으로 밀어냅니다.','천천히 가슴 옆으로 돌아옵니다.'],['어깨가 앞으로 말리지 않게 하세요.']),
('cable_triceps_pushdown','케이블 푸시다운','cable',['triceps'],{'elbow':{'min':60,'max':170,'optimal':160},'shoulder':{'min':0,'max':60,'optimal':25}}, {'primaryJoint':'elbow','bottomThreshold':70,'topThreshold':155,'direction':'down_up'},'삼두근 강화','팔 뒤쪽 근력과 팔꿈치 안정성 향상',['팔꿈치를 몸 옆에 고정합니다.','손잡이를 아래로 밀어 팔을 폅니다.','천천히 팔꿈치를 굽혀 돌아옵니다.'],['팔꿈치가 앞뒤로 흔들리지 않게 하세요.']),
('cable_face_pull','케이블 페이스풀','cable',['rear_deltoid','rhomboids','traps'],base_key_upper, {'primaryJoint':'elbow','bottomThreshold':155,'topThreshold':80,'direction':'up_down'},'후면 어깨와 자세 개선','라운드숄더 완화, 견갑 안정성 향상',['로프를 얼굴 높이에 맞춥니다.','팔꿈치를 벌리며 얼굴 쪽으로 당깁니다.','견갑을 모은 뒤 천천히 풉니다.'],['허리를 젖혀 당기지 마세요.']),
('cable_fly','케이블 플라이','cable',['chest','anterior_deltoid'],{'shoulder':{'min':30,'max':120,'optimal':75},'elbow':{'min':120,'max':175,'optimal':150}}, {'primaryJoint':'shoulder','bottomThreshold':110,'topThreshold':55,'direction':'up_down'},'가슴 수축 집중','가슴 안쪽 자극과 어깨 제어 향상',['케이블을 양손에 잡고 한 발 앞으로 섭니다.','팔꿈치를 살짝 굽힌 채 가슴 앞에서 모읍니다.','천천히 벌려 가슴을 늘립니다.'],['어깨 통증이 있으면 범위를 줄이세요.']),
('russian_twist','러시안 트위스트','core',['core'],{'hip':{'min':70,'max':130,'optimal':100},'spine':{'min':150,'max':180,'optimal':170}}, {'primaryJoint':'hip','isIsometric':True,'direction':'hold'},'복사근과 몸통 회전 제어','코어 회전 안정성 향상',['무릎을 굽히고 앉아 상체를 살짝 뒤로 기울입니다.','복부에 힘을 주고 좌우로 몸통을 회전합니다.','허리가 무너지지 않게 유지합니다.'],['허리 통증이 있으면 발을 바닥에 두세요.']),
('dead_bug','데드버그','core',['core','hip_flexors'],{'hip':{'min':70,'max':140,'optimal':90},'shoulder':{'min':80,'max':180,'optimal':150},'spine':{'min':160,'max':185,'optimal':175}}, {'primaryJoint':'hip','bottomThreshold':90,'topThreshold':130,'direction':'full_cycle'},'허리 부담 적은 코어 안정화','복압 조절과 허리 안정성 향상',['누워서 팔과 다리를 들어 올립니다.','반대쪽 팔과 다리를 천천히 내립니다.','허리가 뜨지 않게 복부에 힘을 줍니다.'],['허리가 뜨면 가동범위를 줄이세요.']),
('side_plank','사이드 플랭크','core',['core','shoulders','glutes'],{'hip':{'min':160,'max':185,'optimal':180},'shoulder':{'min':70,'max':110,'optimal':90},'spine':{'min':160,'max':185,'optimal':180}}, {'primaryJoint':'hip','isIsometric':True,'direction':'hold'},'측면 코어 강화','골반 안정성과 옆구리 근지구력 향상',['팔꿈치를 어깨 아래에 둡니다.','몸을 일직선으로 들어 올립니다.','골반이 떨어지지 않게 유지합니다.'],['어깨가 귀 쪽으로 올라가지 않게 하세요.']),
('hamstring_stretch','햄스트링 스트레칭','stretching',['hamstrings','calves'],{'hip':{'min':60,'max':130,'optimal':90},'knee':{'min':150,'max':180,'optimal':170}}, {'primaryJoint':'hip','isIsometric':True,'direction':'hold'},'허벅지 뒤쪽 유연성 향상','골반 움직임과 허리 부담 완화',['한쪽 다리를 앞으로 뻗습니다.','등을 곧게 세우고 골반부터 접습니다.','허벅지 뒤쪽 당김을 느끼며 유지합니다.'],['반동을 주지 마세요. 통증이 아닌 당김까지만 진행하세요.']),
('quad_stretch','대퇴사두근 스트레칭','stretching',['quadriceps','hip_flexors'],{'knee':{'min':30,'max':90,'optimal':45},'hip':{'min':140,'max':185,'optimal':170}}, {'primaryJoint':'knee','isIsometric':True,'direction':'hold'},'허벅지 앞쪽 유연성 향상','무릎과 골반 전면 긴장 완화',['서서 한쪽 발등을 잡습니다.','무릎을 아래로 향하게 모읍니다.','골반이 앞으로 밀리지 않게 유지합니다.'],['허리를 꺾지 말고 복부에 힘을 주세요.']),
('cat_cow','캣카우','stretching',['core','back'],{'spine':{'min':130,'max':190,'optimal':170},'hip':{'min':80,'max':140,'optimal':100}}, {'primaryJoint':'spine','bottomThreshold':145,'topThreshold':180,'direction':'full_cycle'},'척추 가동성 향상','허리와 등 긴장 완화',['네발기기 자세를 만듭니다.','등을 둥글게 말았다가 천천히 폅니다.','호흡과 함께 부드럽게 반복합니다.'],['목을 과하게 젖히지 마세요.'])]
for item in add:
    ex(*item)
# add info to existing exercises if missing
for e in db['exercises'].values():
    e.setdefault('purpose','근력 향상과 자세 제어 능력 개선')
    e.setdefault('benefits','목표 근육 강화, 관절 안정성 향상, 운동 수행 능력 개선')
    e.setdefault('instructions',['시작 자세를 안정적으로 잡습니다.','관절 정렬을 유지하며 천천히 움직입니다.','반동 없이 목표 근육의 긴장을 느끼며 반복합니다.'])
    e.setdefault('precautions',['통증이 있으면 즉시 중단하세요.','허리와 무릎이 과하게 꺾이지 않게 주의하세요.','초보자는 가벼운 무게와 작은 범위부터 시작하세요.'])
p.write_text(json.dumps(db,ensure_ascii=False,indent=2))
